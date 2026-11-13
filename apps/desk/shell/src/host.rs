//! The browser side of the bridge (#43): a page's call arrives as a process message, is answered off
//! CEF's UI thread after the calls its caller sent before it (`lanes.rs`; a call may wait, for a
//! `perm.request`, the OS calendar prompt or a file dialog, and then holds the rest up only so long),
//! and the reply goes back to the frame it came from on CEF's UI thread. The caller comes from the
//! window the browser is for and the frame's URL (`desk_web::sender`), never from the call (#45).
//! Core events go to the pages of the main, palette and island windows, as Tauri's `emit` did.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use cef::*;
use desk_boot::Booted;
use desk_boot::boot::Keep;
use desk_boot::crash::Crash;
use desk_boot::mcp::McpServers;
use desk_boot::start::Start;
use desk_boot::trace::Tracing;
use desk_core::{Core, Delivery};
use desk_web::sender::{Role, Sender};
use desk_web::wire::{self, Call};
use serde_json::Value;

use crate::eris_window::Eris;
use crate::instance::Instance;
use crate::island::Island;
use crate::open_files::OpenFiles;
use crate::pump::Pump;
use crate::renderer::{MESSAGE, SURFACE};

mod lanes;
use lanes::Lanes;

/// The started desk and what the shell's own commands need.
pub struct Desk {
    pub core: Arc<Core>,
    pub start: Start,
    pub crash: Crash,
    pub tracing: Tracing,
    pub mcp: McpServers,
    /// Files the desk was opened with or handed since, until the runtime takes them.
    pub opened: OpenFiles,
    /// Wakes the event loop and runs window work on its thread.
    pub pump: Pump,
    /// The pages that hear events.
    pub pages: Pages,
    /// Eris's shortcut, once the shell holds it.
    pub eris: OnceLock<Arc<Eris>>,
    /// The island (ADR 0204), once the shell has started.
    pub island: OnceLock<Arc<Island>>,
    /// This desk's hold on being the only one; let go before it starts again.
    pub instance: Mutex<Option<Instance>>,
    /// The desk's own updates, when this build updates itself (#47).
    pub updater: Option<desk_update::Updater>,
    /// The pages' bridge calls, in their lanes.
    calls: Calls,
    /// The watchers and the desk socket, until the desk lets go of them.
    keep: Mutex<Option<Keep>>,
}

impl Desk {
    /// The desk, and its core's events for [`forward_events`].
    pub fn new(
        booted: Booted,
        opened: Vec<String>,
        pump: Pump,
        instance: Option<Instance>,
        updater: Option<desk_update::Updater>,
    ) -> (Arc<Self>, std::sync::mpsc::Receiver<Delivery>) {
        let Booted {
            core,
            start,
            crash,
            tracing,
            mcp,
            events,
            keep,
        } = booted;
        let queue = OpenFiles::default();
        queue.push(opened);
        let desk = Self {
            core,
            start,
            crash,
            tracing,
            mcp,
            opened: queue,
            pump,
            pages: Pages::default(),
            eris: OnceLock::new(),
            island: OnceLock::new(),
            instance: Mutex::new(instance),
            updater,
            calls: Calls::default(),
            keep: Mutex::new(Some(keep)),
        };
        (Arc::new(desk), events)
    }

    /// Give up what only one desk may hold, so the next one can start: being the only desk for the
    /// data folder, the desk socket and the watchers. Dropped here, so nothing of this desk's removes
    /// the next one's files later.
    pub fn let_go(&self) {
        let instance = self
            .instance
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        drop(instance);
        let keep = self.keep.lock().unwrap_or_else(|e| e.into_inner()).take();
        drop(keep);
    }
}

/// How long a call that waits (for the person, a dialog, the network, a later call of its own page)
/// holds up the calls its caller sent after it: far longer than a call that does not wait takes.
const HOLD: Duration = Duration::from_millis(250);

/// The pages' calls in lanes (`lanes.rs`): each page's read one after another in the order it sent
/// them, then each caller's answered one after another in that order, beside every other caller's.
/// A caller is the core caller a bridge call runs as (the runtime's page calls for each plugin it
/// hosts as that plugin), or the shell's own commands of that page.
struct Calls {
    pages: Lanes<String>,
    callers: Lanes<(String, Lane)>,
}

impl Default for Calls {
    fn default() -> Self {
        Self {
            pages: Lanes::strict("desk-bridge-read"),
            callers: Lanes::letting_go("desk-bridge", HOLD),
        }
    }
}

/// Whose calls of its page a call is among.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum Lane {
    /// The shell's own commands (`desk_ready`, `compositor_edit`, …).
    Shell,
    /// The bridge calls that run as this caller.
    Caller(String),
}

impl Lane {
    fn of(sender: &Sender, call: &Call) -> Self {
        if call.cmd != "bridge_call" {
            return Self::Shell;
        }
        let named = call.args.get("caller").and_then(Value::as_str);
        sender.caller(named).map_or(Self::Shell, Self::Caller)
    }
}

/// Answer the call `text` that `frame`, in a browser of `role`, sent; then reply to it. Never waits:
/// the call is read and answered on the bridge's threads, after the calls its caller sent before it.
pub fn receive(desk: &Arc<Desk>, role: Role, frame: Frame, text: String) {
    let url = CefString::from(&frame.url()).to_string();
    let page = CefString::from(&frame.identifier()).to_string();
    let sender = Sender::in_role(role, &url);
    let reading = Arc::clone(desk);
    desk.calls.pages.run(page.clone(), move || {
        let call = match Call::parse(&text) {
            Ok(call) => call,
            Err(why) => return send(frame, wire::reply(0, Err(why))),
        };
        let lane = Lane::of(&sender, &call);
        let desk = Arc::clone(&reading);
        reading.calls.callers.run((page, lane), move || {
            let id = call.id;
            let outcome = crate::commands::answer(&desk, &sender, call);
            send(frame, wire::reply(id, outcome));
        });
    });
}

/// Hand `text` to `frame`'s page on CEF's UI thread.
pub fn send(frame: Frame, text: String) {
    let mut task = SendTask::new(frame, text, None);
    post_task(ThreadId::UI, Some(&mut task));
}

/// Hand the runtime's page in `frame` what the page of surface `surface` posted to its parent
/// (`__deskNative.onSurface`, ADR 0160), on CEF's UI thread.
pub fn send_surface(frame: Frame, surface: &str, text: String) {
    let mut task = SendTask::new(frame, text, Some(surface.to_owned()));
    post_task(ThreadId::UI, Some(&mut task));
}

wrap_task! {
    struct SendTask {
        frame: Frame,
        text: String,
        // The surface a relayed message comes from; none for a reply or an event.
        surface: Option<String>,
    }

    impl Task {
        fn execute(&self) {
            if self.frame.is_valid() != 1 {
                return;
            }
            // What a page hears may change what it shows; if it does, the page asks for frames
            // (#134, `web_host/frame_asks.js`): a message alone no longer wakes a resting surface.
            let name = if self.surface.is_some() { SURFACE } else { MESSAGE };
            if let Some(mut message) = process_message_create(Some(&name.into())) {
                if let Some(list) = message.argument_list() {
                    list.set_string(0, Some(&self.text.as_str().into()));
                    if let Some(surface) = &self.surface {
                        list.set_string(1, Some(&surface.as_str().into()));
                    }
                }
                self.frame.send_process_message(ProcessId::RENDERER, Some(&mut message));
            }
        }
    }
}

/// The windows' browsers, by role, once they exist: where events go.
#[derive(Clone, Default)]
pub struct Pages(Arc<Mutex<HashMap<Role, Browser>>>);

impl Pages {
    pub fn set(&self, role: Role, browser: Option<Browser>) {
        let mut pages = self.0.lock().unwrap_or_else(|e| e.into_inner());
        match browser {
            Some(browser) => pages.insert(role, browser),
            None => pages.remove(&role),
        };
    }

    fn frame(&self, role: Role) -> Option<Frame> {
        let pages = self.0.lock().unwrap_or_else(|e| e.into_inner());
        pages.get(&role).and_then(|b| b.main_frame())
    }

    /// Tell `role`'s page `event` with `payload` (Tauri's `emit_to`).
    pub fn emit(&self, role: Role, event: &str, payload: Value) {
        if let Some(frame) = self.frame(role) {
            send(frame, wire::event(event, payload));
        }
    }
}

/// The windows that hear core events: the banner is a plugin page without the bridge.
const HEARING: [Role; 3] = [Role::Main, Role::Palette, Role::Island];

/// Forward every core event to the pages as `bridge://event`, on a thread of its own.
pub fn forward_events(events: std::sync::mpsc::Receiver<Delivery>, pages: Pages) {
    let spawned = std::thread::Builder::new()
        .name("desk-events".to_owned())
        .spawn(move || {
            for delivery in events {
                let payload = desk_boot::events::payload(delivery);
                for role in HEARING {
                    pages.emit(role, "bridge://event", payload.clone());
                }
            }
        });
    if let Err(why) = spawned {
        eprintln!("endue Desk: no thread for core events ({why})");
    }
}

#[cfg(test)]
mod tests {
    use super::Lane;
    use desk_web::sender::Sender;
    use desk_web::wire::Call;

    fn lane(sender: &Sender, text: &str) -> Lane {
        Lane::of(sender, &Call::parse(text).unwrap())
    }

    #[test]
    fn a_call_is_in_the_lane_of_the_caller_it_runs_as() {
        let runtime = Sender::Runtime;
        let call = r#"{"id":1,"cmd":"bridge_call","args":{"request":{}}}"#;
        assert_eq!(lane(&runtime, call), Lane::Caller("desk".into()));
        // The runtime's page calls for each plugin it hosts in that plugin's lane.
        let hosted =
            r#"{"id":2,"cmd":"bridge_call","args":{"request":{},"caller":"endue.terminal"}}"#;
        assert_eq!(
            lane(&runtime, hosted),
            Lane::Caller("endue.terminal".into())
        );
        let notes = r#"{"id":3,"cmd":"bridge_call","args":{"request":{},"caller":"endue.notes"}}"#;
        assert_eq!(lane(&runtime, notes), Lane::Caller("endue.notes".into()));
        // A plugin's frame is its own caller whatever it names.
        let plugin = Sender::Plugin("endue.terminal".into());
        assert_eq!(lane(&plugin, notes), Lane::Caller("endue.terminal".into()));
        assert_eq!(lane(&Sender::Palette, call), Lane::Caller("palette".into()));
    }

    #[test]
    fn the_shells_own_commands_have_a_lane_of_their_own() {
        let edit = r#"{"id":4,"cmd":"compositor_edit","args":{"seq":1,"edits":[]}}"#;
        assert_eq!(lane(&Sender::Runtime, edit), Lane::Shell);
        let dialog = r#"{"id":5,"cmd":"plugin:dialog|open","args":{}}"#;
        assert_eq!(lane(&Sender::Runtime, dialog), Lane::Shell);
        // No bridge for a page the desk does not know: refused at once, beside the shell's commands.
        let call = r#"{"id":6,"cmd":"bridge_call","args":{"request":{}}}"#;
        assert_eq!(lane(&Sender::Unknown, call), Lane::Shell);
    }
}
