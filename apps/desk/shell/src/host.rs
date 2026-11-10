//! The browser side of the bridge (#43): a page's call arrives as a process message, is answered on a
//! thread of its own (a call may wait: a `perm.request`, the OS calendar prompt, a file dialog), and
//! the reply goes back to the frame it came from on CEF's UI thread. The caller comes from the
//! window the browser is for and the frame's URL (`desk_web::sender`), never from the call (#45).
//! Core events go to the pages of the main, palette and Eris windows, as Tauri's `emit` did.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

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

use crate::eris_window::ErisWindow;
use crate::instance::Instance;
use crate::open_files::OpenFiles;
use crate::pump::Pump;
use crate::renderer::{MESSAGE, SURFACE};

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
    /// The floating Eris, once its window exists.
    pub eris: OnceLock<Arc<ErisWindow>>,
    /// This desk's hold on being the only one; let go before it starts again.
    pub instance: Mutex<Option<Instance>>,
    /// The desk's own updates, when this build updates itself (#47).
    pub updater: Option<desk_update::Updater>,
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
            instance: Mutex::new(instance),
            updater,
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

/// Answer the call `text` that `frame`, in a browser of `role`, sent; then reply to it.
pub fn receive(desk: &Arc<Desk>, role: Role, frame: Frame, text: String) {
    let url = CefString::from(&frame.url()).to_string();
    let sender = Sender::in_role(role, &url);
    let desk = Arc::clone(desk);
    let spawned = std::thread::Builder::new()
        .name("desk-bridge".to_owned())
        .spawn(move || {
            let (id, outcome) = match Call::parse(&text) {
                Ok(call) => (call.id, crate::commands::answer(&desk, &sender, call)),
                Err(why) => (0, Err(why)),
            };
            send(frame, wire::reply(id, outcome));
        });
    if let Err(why) = spawned {
        eprintln!("endue Desk: no thread for a bridge call ({why})");
    }
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
const HEARING: [Role; 3] = [Role::Main, Role::Palette, Role::Eris];

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
