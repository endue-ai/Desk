//! A native plugin's side of its surface connection: it connects from the environment the desk
//! started it with, hears the desk's messages (and answers each `desk:ping` itself, as the SDK does
//! in a frame), and sends its frames, title, page messages and the focus it hands back past an end
//! of its focus order (`focus.leave`, #128). Hearing is the plugin's own loop: a
//! plugin whose loop hangs stops answering pings, and its window says Not responding (#32 §9).

use std::io::{self, Write};
use std::os::fd::FromRawFd;
use std::os::unix::net::UnixStream;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use serde_json::{Value, json};

use super::bridge::Bridge;
use super::lines::{LineReader, Next, compositor_message, line};
use crate::generated::{SurfaceAttach, SurfaceFocusEdge, SurfaceFocusLeave, SurfaceFocusLeaveType};
use crate::{CompositorMessage, SurfaceMessage, env};

/// What a look at the surface connection heard.
#[derive(Debug)]
pub enum Heard {
    Message(Box<CompositorMessage>),
    /// Nothing within the time given.
    Idle,
    /// The desk closed the connection: the process should exit.
    Closed,
}

/// A native plugin's connections.
pub struct Plugin {
    id: String,
    writer: Mutex<UnixStream>,
    reader: LineReader<UnixStream>,
    bridge: Option<Bridge>,
    #[cfg(target_os = "macos")]
    ports: Option<super::mach::PortSender>,
}

/// The stream on the inherited descriptor the variable `name` holds.
#[allow(unsafe_code)]
fn inherited(name: &str) -> io::Result<UnixStream> {
    let fd: i32 = std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|fd| *fd > 2)
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                format!("{name} names no descriptor"),
            )
        })?;
    // SAFETY: the desk started this process with `fd` open for this connection, and nothing else
    // in the process owns it; once taken it is closed on exec, so children do not inherit it.
    let stream = unsafe {
        if libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) == -1 {
            return Err(io::Error::last_os_error());
        }
        UnixStream::from_raw_fd(fd)
    };
    Ok(stream)
}

impl Plugin {
    /// Connect from the environment the desk started this process with.
    pub fn connect() -> io::Result<Plugin> {
        let id = std::env::var(env::PLUGIN_ID)
            .map_err(|_| io::Error::new(io::ErrorKind::NotFound, "not started by a desk"))?;
        let surface = inherited(env::SURFACE_FD)?;
        let bridge = inherited(env::BRIDGE_FD).ok();
        #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
        let mut plugin = Plugin::over(id, surface, bridge)?;
        #[cfg(target_os = "macos")]
        if let Ok(name) = std::env::var(env::MACH_SERVICE) {
            plugin.ports = Some(super::mach::PortSender::look_up(&name)?);
        }
        Ok(plugin)
    }

    /// A plugin over streams it already has (tests, other launchers).
    pub fn over(id: String, surface: UnixStream, bridge: Option<UnixStream>) -> io::Result<Plugin> {
        Ok(Plugin {
            id,
            writer: Mutex::new(surface.try_clone()?),
            reader: LineReader::new(surface),
            bridge: bridge.map(Bridge::new).transpose()?,
            #[cfg(target_os = "macos")]
            ports: None,
        })
    }

    /// The plugin's id, as the desk knows it.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// The bridge, when the desk gave one.
    pub fn bridge(&self) -> Option<&Bridge> {
        self.bridge.as_ref()
    }

    fn writer(&self) -> MutexGuard<'_, UnixStream> {
        self.writer.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The desk's next message, waiting at most `timeout` (`None`: until one comes). Pings are
    /// answered here and not handed on.
    pub fn next(&mut self, timeout: Option<Duration>) -> io::Result<Heard> {
        let timeout = timeout.map(|t| t.max(Duration::from_millis(1)));
        // macOS refuses the option once the desk has closed its end; the read then ends at once.
        let _ = self.reader.get_ref().set_read_timeout(timeout);
        loop {
            let text = match self.reader.next_line()? {
                Next::Line(text) => text,
                Next::Idle => return Ok(Heard::Idle),
                Next::Closed => return Ok(Heard::Closed),
            };
            let Some(message) = compositor_message(&text) else {
                continue;
            };
            if let CompositorMessage::SurfaceDesk(desk) = &message {
                match desk.message.get("type").and_then(Value::as_str) {
                    Some("desk:ping") => {
                        let n = desk.message.get("n").cloned().unwrap_or(json!(0));
                        self.post(&desk.surface, json!({ "type": "desk:pong", "n": n }))?;
                        continue;
                    }
                    // The plugin runs and listens: it is up (ADR 0061), as a frame's mount says.
                    Some("desk:init") => {
                        self.post(&desk.surface, json!({ "type": "desk:ready" }))?
                    }
                    _ => {}
                }
            }
            return Ok(Heard::Message(Box::new(message)));
        }
    }

    /// Send `message` to the desk.
    pub fn send(&self, message: &SurfaceMessage) -> io::Result<()> {
        let bytes = line(message)?;
        self.writer().write_all(&bytes)
    }

    fn send_value(&self, value: Value) -> io::Result<()> {
        let message: SurfaceMessage = serde_json::from_value(value)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?;
        self.send(&message)
    }

    /// Post a page message (`desk:hello`, `desk:state`, ...) about `surface` to the desk.
    pub fn post(&self, surface: &str, message: Value) -> io::Result<()> {
        self.send_value(json!({ "type": "plugin.message", "surface": surface, "message": message }))
    }

    /// `desk:hello`: the plugin listens; the desk answers with `desk:init`.
    pub fn hello(&self, surface: &str) -> io::Result<()> {
        self.post(surface, json!({ "type": "desk:hello" }))
    }

    /// Keep `state` with the desk: the next `desk:init` after a wake hands it back as `restored`.
    pub fn keep(&self, surface: &str, state: Value) -> io::Result<()> {
        self.post(surface, json!({ "type": "desk:state", "state": state }))
    }

    /// The surface is loaded and takes input.
    pub fn ready(&self, surface: &str) -> io::Result<()> {
        self.send_value(json!({ "type": "ready", "surface": surface }))
    }

    /// The title for the surface's window.
    pub fn title(&self, surface: &str, title: &str) -> io::Result<()> {
        self.send_value(json!({ "type": "title", "surface": surface, "title": title }))
    }

    /// Hand the focus back to the desk past `edge` of the plugin's focus order (`focus.leave`):
    /// Tab went past its last element, or Shift+Tab before its first (`focus::FocusOrder`).
    pub fn leave_focus(&self, surface: &str, edge: SurfaceFocusEdge) -> io::Result<()> {
        self.send(&SurfaceMessage::SurfaceFocusLeave(SurfaceFocusLeave {
            r#type: SurfaceFocusLeaveType::FocusLeave,
            surface: surface.to_owned(),
            edge,
        }))
    }

    /// A frame. On macOS, `right` is the IOSurface whose Mach send right goes first, for the first
    /// frame of a texture id and generation (the attach then names `portIndex` 0).
    #[cfg(target_os = "macos")]
    pub fn attach(
        &self,
        attach: &SurfaceAttach,
        right: Option<&objc2_io_surface::IOSurfaceRef>,
    ) -> io::Result<()> {
        let bytes = line(&SurfaceMessage::SurfaceAttach(attach.clone()))?;
        let mut writer = self.writer();
        if let Some(surface) = right {
            let ports = self.ports.as_ref().ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::NotConnected,
                    "the desk named no Mach service",
                )
            })?;
            ports.send(surface)?;
        }
        writer.write_all(&bytes)
    }

    /// A frame whose handle travels in the line alone.
    #[cfg(not(target_os = "macos"))]
    pub fn attach(&self, attach: &SurfaceAttach) -> io::Result<()> {
        self.send(&SurfaceMessage::SurfaceAttach(attach.clone()))
    }
}

#[cfg(test)]
mod tests {
    use super::{Heard, Plugin};
    use crate::CompositorMessage;
    use crate::generated::SurfaceFocusEdge;
    use crate::native::lines::{LineReader, Next};
    use std::io::Write;
    use std::os::unix::net::UnixStream;
    use std::time::Duration;

    #[test]
    fn the_plugin_answers_pings_itself_and_hands_on_the_rest() {
        let (desk, mine) = UnixStream::pair().unwrap();
        let mut plugin = Plugin::over("example.native".into(), mine, None).unwrap();
        let surface = "main.example-native";
        (&desk)
            .write_all(
                format!(
                    "{{\"type\":\"desk.message\",\"surface\":\"{surface}\",\"message\":{{\"type\":\"desk:ping\",\"n\":7}}}}\n\
                     not json\n{{\"type\":\"hide\",\"surface\":\"{surface}\"}}\n"
                )
                .as_bytes(),
            )
            .unwrap();
        let heard = plugin.next(Some(Duration::from_secs(2))).unwrap();
        assert!(
            matches!(heard, Heard::Message(m) if matches!(*m, CompositorMessage::SurfaceHide(_)))
        );
        let mut reader = LineReader::new(desk.try_clone().unwrap());
        let Next::Line(pong) = reader.next_line().unwrap() else {
            panic!()
        };
        let pong: serde_json::Value = serde_json::from_str(&pong).unwrap();
        assert_eq!(pong["type"], "plugin.message");
        assert_eq!(
            pong["message"],
            serde_json::json!({ "type": "desk:pong", "n": 7 })
        );
        assert!(matches!(
            plugin.next(Some(Duration::from_millis(20))).unwrap(),
            Heard::Idle
        ));
        drop((desk, reader));
        assert!(matches!(plugin.next(None).unwrap(), Heard::Closed));
    }

    #[test]
    fn focus_enter_reaches_the_plugin_and_it_hands_the_focus_back_past_an_end() {
        let (desk, mine) = UnixStream::pair().unwrap();
        let mut plugin = Plugin::over("example.native".into(), mine, None).unwrap();
        let surface = "main.example-native";
        (&desk)
            .write_all(
                format!(
                    "{{\"type\":\"focus.enter\",\"surface\":\"{surface}\",\"edge\":\"last\"}}\n"
                )
                .as_bytes(),
            )
            .unwrap();
        let heard = plugin.next(Some(Duration::from_secs(2))).unwrap();
        let Heard::Message(message) = heard else {
            panic!("{heard:?}")
        };
        let CompositorMessage::SurfaceFocusEnter(enter) = *message else {
            panic!("{message:?}")
        };
        assert_eq!(enter.edge, SurfaceFocusEdge::Last);
        plugin
            .leave_focus(surface, SurfaceFocusEdge::First)
            .unwrap();
        let mut reader = LineReader::new(desk.try_clone().unwrap());
        let Next::Line(line) = reader.next_line().unwrap() else {
            panic!()
        };
        let line: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(
            line,
            serde_json::json!({ "type": "focus.leave", "surface": surface, "edge": "first" })
        );
    }
}
