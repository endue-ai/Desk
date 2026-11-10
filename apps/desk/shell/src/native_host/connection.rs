//! One native plugin's surface connection, the desk's end: a writer thread for what the desk sends
//! (the desk never waits on a plugin), and a reader thread for what the plugin sends. Frames go to
//! the compositor's `SurfaceSink`, each answered with its `release`s; page messages go up to the
//! runtime through the relay, and so does the focus it hands back (`focus.leave`, as a web page's
//! `OnTakeFocus`); `died` is the desk's to say and is dropped; a message about a surface
//! of another plugin is dropped. On macOS a frame's IOSurface comes as a Mach send right from the
//! process the desk started, and only an IOSurface it sent can be named (`desk_surface::native::
//! mach`): a plugin cannot show another surface's pixels.

use std::collections::VecDeque;
use std::io::{self, Write};
use std::os::unix::net::UnixStream;
use std::sync::mpsc::Receiver;
use std::thread;

use desk_compositor::Source;
use desk_surface::generated::{SurfaceAttach, SurfaceMessage};
use desk_surface::native::lines::{LineReader, Next, surface_message};
use serde_json::json;

use super::NativeHost;

/// How many of a process's IOSurfaces stay nameable: two or three rotate, a resize adds more.
#[cfg(target_os = "macos")]
const KEPT: usize = 8;

/// What the desk keeps for one process's connection before it starts.
pub(super) struct Connection {
    #[cfg(target_os = "macos")]
    ports: desk_surface::native::mach::PortService,
}

impl Connection {
    /// Ready a connection, and the environment its process needs for it.
    pub(super) fn prepare() -> io::Result<(Connection, Vec<(String, String)>)> {
        #[cfg(target_os = "macos")]
        {
            let ports = desk_surface::native::mach::PortService::check_in()?;
            let env = vec![(
                desk_surface::env::MACH_SERVICE.to_owned(),
                ports.name().to_owned(),
            )];
            Ok((Connection { ports }, env))
        }
        #[cfg(not(target_os = "macos"))]
        Ok((Connection {}, Vec::new()))
    }

    /// Serve `stream` for `plugin`'s process `pid`: write what comes on `lines`, read what it says.
    pub(super) fn serve(
        self,
        host: NativeHost,
        plugin: String,
        pid: u32,
        stream: UnixStream,
        lines: Receiver<Vec<u8>>,
    ) -> io::Result<()> {
        let mut writer = stream.try_clone()?;
        thread::Builder::new()
            .name("desk-native-surface-write".to_owned())
            .spawn(move || {
                for bytes in lines {
                    if writer.write_all(&bytes).is_err() {
                        break;
                    }
                }
            })?;
        thread::Builder::new()
            .name("desk-native-surface-read".to_owned())
            .spawn(move || {
                let mut reader = Reader {
                    host,
                    plugin,
                    pid,
                    connection: self,
                    kept: VecDeque::new(),
                    refused: 0,
                };
                let mut lines = LineReader::new(stream);
                while let Ok(next) = lines.next_line() {
                    match next {
                        Next::Line(text) => reader.line(&text),
                        Next::Idle => {}
                        Next::Closed => break,
                    }
                }
            })?;
        Ok(())
    }
}

struct Reader {
    host: NativeHost,
    plugin: String,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pid: u32,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    connection: Connection,
    /// The IOSurfaces this process sent, newest last.
    #[cfg(target_os = "macos")]
    kept: VecDeque<desk_surface::native::mach::IoSurface>,
    #[cfg(not(target_os = "macos"))]
    kept: VecDeque<()>,
    refused: u64,
}

impl Reader {
    fn line(&mut self, text: &str) {
        let Some(message) = surface_message(text) else {
            return;
        };
        let surface = match serde_json::to_value(&message) {
            Ok(value) => value["surface"].as_str().unwrap_or_default().to_owned(),
            Err(_) => return,
        };
        let mine =
            (self.host.inner().surfaces.get(&surface)).is_some_and(|s| s.plugin == self.plugin);
        if !mine {
            return;
        }
        match message {
            SurfaceMessage::SurfaceAttach(attach) => self.attach(&attach),
            // The process cannot say it is dead: the desk says so when it ends.
            SurfaceMessage::SurfaceDied(_) => {}
            SurfaceMessage::SurfacePlugin(post) => {
                if let Ok(text) = serde_json::to_string(&post.message) {
                    self.host.relay.up(&post.surface, text);
                }
            }
            // Past an end of its focus order: the runtime page's focus goes on from its place,
            // which takes it only while it has that focus (#128).
            SurfaceMessage::SurfaceFocusLeave(leave) => {
                self.host
                    .relay
                    .leave(&leave.surface, super::page::forward(&leave));
            }
            other => {
                self.host.sink.message(other);
                self.host.wake();
            }
        }
    }

    /// A frame: imported and composed, then released; refused frames are released at once.
    fn attach(&mut self, attach: &SurfaceAttach) {
        let released = match self.check(attach) {
            Ok(here) => match self.host.sink.attach(&here, Source::Handle) {
                Ok(attached) => {
                    self.host.wake();
                    attached.released
                }
                Err(why) => {
                    self.refuse(&why.to_string());
                    vec![attach.frame]
                }
            },
            Err(why) => {
                self.refuse(&why);
                vec![attach.frame]
            }
        };
        for frame in released {
            let release = json!({ "type": "release", "surface": attach.surface, "frame": frame });
            if let Ok(message) = serde_json::from_value(release) {
                self.host.write(&self.plugin, &message);
            }
        }
    }

    fn refuse(&mut self, why: &str) {
        self.refused += 1;
        if self.refused == 1 || self.refused.is_power_of_two() {
            eprintln!(
                "endue Desk: a frame of native plugin {} was refused ({} so far): {why}",
                self.plugin, self.refused
            );
        }
    }

    /// The frame as the compositor imports it in this process, if it names a texture this process
    /// may name: on macOS an IOSurface whose right it sent now (`portIndex`) or before. The desk
    /// holds that IOSurface then, so the frame names it by its id alone.
    #[cfg(target_os = "macos")]
    fn check(&mut self, attach: &SurfaceAttach) -> Result<SurfaceAttach, String> {
        use desk_surface::generated::SurfaceTextureHandle;
        let SurfaceTextureHandle::SurfaceIoSurface(handle) = &attach.texture.handle else {
            return Err("only IOSurfaces carry frames on macOS".to_owned());
        };
        if handle.port_index.is_some() {
            let timeout = std::time::Duration::from_secs(1);
            let (id, surface) = (self.connection.ports)
                .receive(self.pid, timeout)
                .map_err(|e| format!("its IOSurface's right: {e}"))?;
            if u64::from(id) != handle.id {
                return Err(format!(
                    "the right is IOSurface {id}, the frame names {}",
                    handle.id
                ));
            }
            if self.kept.len() == KEPT {
                self.kept.pop_front();
            }
            self.kept.push_back(surface);
        }
        if !self.kept.iter().any(|s| u64::from(s.id()) == handle.id) {
            return Err(format!(
                "IOSurface {} is not one this plugin sent",
                handle.id
            ));
        }
        let mut here = attach.clone();
        if let SurfaceTextureHandle::SurfaceIoSurface(handle) = &mut here.texture.handle {
            handle.port_index = None;
        }
        Ok(here)
    }

    /// Elsewhere the compositor cannot import a plugin's frames yet: D3D11 handles and DMA-BUFs
    /// across processes are #61's.
    #[cfg(not(target_os = "macos"))]
    fn check(&mut self, _attach: &SurfaceAttach) -> Result<SurfaceAttach, String> {
        self.kept.clear();
        Err("frames from another process are imported on macOS only until #61".to_owned())
    }
}
