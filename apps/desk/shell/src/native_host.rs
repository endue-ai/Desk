//! The native host (#59, ADR 0154): the surface protocol's (`specs/surface/v0`) implementation for
//! native plugins, beside the web host. Each native plugin is a process of its own that the core
//! starts (`desk_core::native`), with two connections the desk made for it: the bridge, which the
//! core serves as that plugin, and the surface connection, spoken here. `create` and `wake` start
//! the process when it has none; `sleep` and `destroy` stop it (its connections close, its grace,
//! then a kill); a process that ends while its surface is live is `died`, which the compositor
//! recovers as it does a web surface's (#44). Its frames reach the compositor as `attach`es through
//! the same `SurfaceSink` (`connection.rs`), its page messages reach the runtime through the relay,
//! so the runtime's pings, kept state and live budget apply to it as to a web plugin. Tab crosses
//! its window's stand-in as it crosses a web plugin's (#128): `focus.enter` in, `focus.leave` out
//! (`page.rs`).

mod connection;
mod page;

use std::collections::HashMap;
use std::sync::mpsc::{self, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, MutexGuard};

use desk_bridge::PluginKind;
use desk_core::native::{Ended, Exit, NativeProcess};
use desk_surface::generated::{
    CompositorMessage, SurfaceDeathReason, SurfaceDied, SurfaceDiedType, SurfaceMessage,
};
use desk_surface::native::lines::line;
use serde_json::{Value, json};

use crate::host::Desk;
use crate::web_host::SurfaceSink;
use crate::web_host::lifecycle::surface_of;
use crate::web_host::relay::Relay;

/// Lines that may wait for a plugin before it counts as gone.
const QUEUE: usize = 1000;

struct Surface {
    plugin: String,
    /// Out of the live budget, or dead: no process needed for it.
    idle: bool,
    /// Its last size and scale, for a process started again (hot reload).
    size: Option<(Value, f64)>,
}

struct Running {
    process: NativeProcess,
    queue: SyncSender<Vec<u8>>,
    start: u64,
}

#[derive(Default)]
struct Counts {
    starts: u64,
    deaths: u64,
    last: Option<String>,
}

#[derive(Default)]
struct Inner {
    surfaces: HashMap<String, Surface>,
    running: HashMap<String, Running>,
    counts: HashMap<String, Counts>,
    starts: u64,
}

/// The native host. Cheap to clone; every clone is the same host.
#[derive(Clone)]
pub struct NativeHost {
    inner: Arc<Mutex<Inner>>,
    sink: Arc<dyn SurfaceSink>,
    relay: Relay,
    desk: Arc<Desk>,
}

impl NativeHost {
    pub fn new(sink: Arc<dyn SurfaceSink>, relay: Relay, desk: Arc<Desk>) -> NativeHost {
        NativeHost {
            inner: Arc::default(),
            sink,
            relay,
            desk,
        }
    }

    fn inner(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Whether `plugin` is a native plugin.
    fn is_native(&self, plugin: &str) -> bool {
        (self.desk.core.plugins().iter()).any(|p| {
            p.id == plugin
                && p.manifest
                    .as_ref()
                    .is_some_and(|m| m.kind == PluginKind::Native)
        })
    }

    /// Whether `surface` is a native plugin's.
    pub fn owns(&self, surface: &str) -> bool {
        self.inner().surfaces.contains_key(surface)
    }

    /// A message from the compositor; `false` when it is not about a native plugin's surface,
    /// for the web host.
    pub fn send(&self, message: &CompositorMessage) -> bool {
        let Some(surface) = surface_of(message) else {
            return false;
        };
        if let CompositorMessage::SurfaceCreate(create) = message
            && !self.owns(&surface)
        {
            if !self.is_native(&create.plugin) {
                return false;
            }
            let record = Surface {
                plugin: create.plugin.clone(),
                idle: false,
                size: None,
            };
            self.inner().surfaces.insert(surface.clone(), record);
            self.relay_down(&surface);
        }
        let Some(plugin) = self
            .inner()
            .surfaces
            .get(&surface)
            .map(|s| s.plugin.clone())
        else {
            return false;
        };
        if let Some(size) = size_of(message)
            && let Some(record) = self.inner().surfaces.get_mut(&surface)
        {
            record.size = Some(size);
        }
        match message {
            CompositorMessage::SurfaceCreate(_) | CompositorMessage::SurfaceWake(_) => {
                if let Some(record) = self.inner().surfaces.get_mut(&surface) {
                    record.idle = false;
                }
                self.ensure(&plugin, &surface);
                self.write(&plugin, message);
            }
            CompositorMessage::SurfaceSleep(_) => {
                self.write(&plugin, message);
                if let Some(record) = self.inner().surfaces.get_mut(&surface) {
                    record.idle = true;
                }
                self.stop_unneeded(&plugin);
            }
            CompositorMessage::SurfaceDestroy(_) => {
                self.write(&plugin, message);
                self.inner().surfaces.remove(&surface);
                self.relay.native(&surface, None);
                self.stop_unneeded(&plugin);
            }
            _ => self.write(&plugin, message),
        }
        true
    }

    /// Surface `surface` has a new document (its plugin's files changed): a running process starts
    /// again, at the surface's last size, so a rebuilt program runs. `false` when it is not a native
    /// plugin's surface.
    pub fn load(&self, surface: &str) -> bool {
        let (plugin, size) = {
            let inner = self.inner();
            let Some(record) = inner.surfaces.get(surface) else {
                return false;
            };
            (record.plugin.clone(), record.size.clone())
        };
        let old = self.inner().running.remove(&plugin);
        let (Some(old), Some((size, scale))) = (old, size) else {
            return true;
        };
        old.process.stop();
        let wake = json!({ "type": "wake", "surface": surface, "size": size, "scale": scale });
        if let Ok(message) = serde_json::from_value::<CompositorMessage>(wake) {
            self.send(&message);
        }
        true
    }

    /// The runtime's messages for `surface`'s page go to its process as `desk.message`, and Tab into
    /// its stand-in as `focus.enter` (`page.rs`, #128).
    fn relay_down(&self, surface: &str) {
        let host = self.clone();
        let target = surface.to_owned();
        let down = move |text: String| {
            if let Some(message) = page::down(&target, &text) {
                host.send(&message);
            }
        };
        self.relay.native(surface, Some(Arc::new(down)));
    }

    /// Write `message` to `plugin`'s process, if it runs; a process that stopped reading is stopped.
    fn write(&self, plugin: &str, message: &CompositorMessage) {
        let Ok(bytes) = line(message) else {
            return;
        };
        let full = {
            let inner = self.inner();
            let Some(running) = inner.running.get(plugin) else {
                return;
            };
            matches!(running.queue.try_send(bytes), Err(TrySendError::Full(_)))
        };
        if full {
            eprintln!("endue Desk: native plugin {plugin} stopped reading; it is stopped");
            if let Some(running) = self.inner().running.get(plugin) {
                running.process.kill();
            }
        }
    }

    /// Start `plugin`'s process unless it runs.
    fn ensure(&self, plugin: &str, surface: &str) {
        if self.inner().running.contains_key(plugin) {
            return;
        }
        if let Err(why) = self.start(plugin) {
            eprintln!("endue Desk: native plugin {plugin} did not start: {why}");
            self.died(surface, SurfaceDeathReason::LaunchFailed, None);
        }
    }

    fn start(&self, plugin: &str) -> Result<(), String> {
        let launch = self
            .desk
            .core
            .native_launch(plugin)
            .map_err(|e| e.message)?;
        let start = {
            let mut inner = self.inner();
            inner.starts += 1;
            inner.counts.entry(plugin.to_owned()).or_default().starts += 1;
            inner.starts
        };
        let (connection, extra) = connection::Connection::prepare().map_err(|e| e.to_string())?;
        let host = self.clone();
        let who = plugin.to_owned();
        let mut process = NativeProcess::start(&self.desk.core, &launch, &extra, move |ended| {
            host.ended(&who, start, ended);
        })
        .map_err(|e| e.to_string())?;
        let stream = process.take_surface().ok_or("no surface connection")?;
        let (queue, lines) = mpsc::sync_channel::<Vec<u8>>(QUEUE);
        connection
            .serve(
                self.clone(),
                plugin.to_owned(),
                process.pid(),
                stream,
                lines,
            )
            .map_err(|e| e.to_string())?;
        // A new page for each of its surfaces: it says hello itself.
        let surfaces: Vec<String> = (self.inner().surfaces.iter())
            .filter(|(_, s)| s.plugin == plugin)
            .map(|(id, _)| id.clone())
            .collect();
        for surface in surfaces {
            self.relay_down(&surface);
        }
        self.inner().running.insert(
            plugin.to_owned(),
            Running {
                process,
                queue,
                start,
            },
        );
        Ok(())
    }

    /// Stop `plugin`'s process when none of its surfaces needs it.
    fn stop_unneeded(&self, plugin: &str) {
        let mut inner = self.inner();
        let needed = (inner.surfaces.values()).any(|s| s.plugin == plugin && !s.idle);
        if !needed && let Some(running) = inner.running.remove(plugin) {
            running.process.stop();
        }
    }

    /// `plugin`'s process `start` ended: unless the desk asked, each live surface of it died.
    fn ended(&self, plugin: &str, start: u64, ended: Ended) {
        let live: Vec<String> = {
            let mut inner = self.inner();
            if inner.running.get(plugin).is_some_and(|r| r.start == start) {
                inner.running.remove(plugin);
            }
            let counts = inner.counts.entry(plugin.to_owned()).or_default();
            counts.last = Some(format!("{:?}", ended.exit));
            if ended.asked {
                return;
            }
            counts.deaths += 1;
            (inner.surfaces.iter_mut())
                .filter(|(_, s)| s.plugin == plugin && !s.idle)
                .map(|(id, s)| {
                    s.idle = true;
                    id.clone()
                })
                .collect()
        };
        let (reason, code) = match ended.exit {
            Exit::Signal(9) => (SurfaceDeathReason::Killed, Some(9)),
            Exit::Signal(signal) => (SurfaceDeathReason::Crashed, Some(i64::from(signal))),
            Exit::Code(code) => (SurfaceDeathReason::Exited, Some(i64::from(code))),
        };
        for surface in live {
            self.died(&surface, reason, code);
        }
    }

    fn died(&self, surface: &str, reason: SurfaceDeathReason, exit_code: Option<i64>) {
        self.sink.message(SurfaceMessage::SurfaceDied(SurfaceDied {
            r#type: SurfaceDiedType::Died,
            surface: surface.to_owned(),
            reason,
            exit_code,
        }));
        self.wake();
    }

    /// Wake the desk's event loop: it composes and acts on what the surfaces said.
    fn wake(&self) {
        self.desk.pump.run(|_, _| {});
    }

    /// Kill every process (the desk quits).
    pub fn close_all(&self) {
        let running: Vec<Running> = self.inner().running.drain().map(|(_, r)| r).collect();
        for running in running {
            running.process.kill();
        }
    }

    /// Each native plugin's process: its pid while it runs, its starts and deaths.
    pub fn stats(&self) -> Value {
        let inner = self.inner();
        let plugins: serde_json::Map<String, Value> = (inner.counts.iter())
            .map(|(plugin, counts)| {
                let pid = inner.running.get(plugin).map(|r| r.process.pid());
                let value = json!({ "pid": pid, "starts": counts.starts, "deaths": counts.deaths,
                    "last": counts.last });
                (plugin.clone(), value)
            })
            .collect();
        Value::Object(plugins)
    }
}

/// The size and scale a lifecycle message brings, as the protocol writes them.
fn size_of(message: &CompositorMessage) -> Option<(Value, f64)> {
    let (size, scale) = match message {
        CompositorMessage::SurfaceCreate(m) => (&m.size, m.scale),
        CompositorMessage::SurfaceResize(m) => (&m.size, m.scale),
        CompositorMessage::SurfaceWake(m) => (&m.size, m.scale),
        _ => return None,
    };
    Some((serde_json::to_value(size).ok()?, scale))
}
