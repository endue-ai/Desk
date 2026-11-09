//! The browser side of the bridge (#43): a page's call arrives as a process message, is answered on a
//! thread of its own (a call may wait: a `perm.request`, the OS calendar prompt), and the reply goes
//! back to the frame it came from on CEF's UI thread. The caller comes from the frame's URL
//! (`desk_web::sender`), never from the call. Core events go to the main window's page.

use std::sync::{Arc, Mutex};

use cef::*;
use desk_boot::Booted;
use desk_boot::boot::Keep;
use desk_boot::crash::Crash;
use desk_boot::mcp::McpServers;
use desk_boot::start::Start;
use desk_boot::trace::Tracing;
use desk_bridge::BridgeRequest;
use desk_core::{Core, Delivery};
use desk_web::sender::Sender;
use desk_web::wire::{self, Call};
use serde_json::{Value, json};

use crate::renderer::MESSAGE;

/// The started desk and what the runtime's own commands need.
pub struct Desk {
    pub core: Arc<Core>,
    pub start: Start,
    pub crash: Crash,
    pub tracing: Tracing,
    pub mcp: McpServers,
    /// Files the desk was opened with, until the runtime takes them (`take_open_files`).
    pub opened: Mutex<Vec<String>>,
    _keep: Keep,
}

impl Desk {
    /// The desk, and its core's events for [`forward_events`].
    pub fn new(
        booted: Booted,
        opened: Vec<String>,
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
        let desk = Self {
            core,
            start,
            crash,
            tracing,
            mcp,
            opened: Mutex::new(opened),
            _keep: keep,
        };
        (Arc::new(desk), events)
    }
}

/// Answer the call `text` that `frame` sent, then reply to it.
pub fn receive(desk: &Arc<Desk>, frame: Frame, text: String) {
    let url = CefString::from(&frame.url()).to_string();
    let sender = Sender::of(&url);
    let desk = Arc::clone(desk);
    let spawned = std::thread::Builder::new()
        .name("desk-bridge".to_owned())
        .spawn(move || {
            let (id, outcome) = match Call::parse(&text) {
                Ok(call) => (call.id, answer(&desk, &sender, call)),
                Err(why) => (0, Err(why)),
            };
            send(frame, wire::reply(id, outcome));
        });
    if let Err(why) = spawned {
        eprintln!("endue Desk: no thread for a bridge call ({why})");
    }
}

/// What a call answers, by its command (the names the Tauri shell's commands have).
fn answer(desk: &Desk, sender: &Sender, call: Call) -> Result<Value, String> {
    let Desk {
        core,
        start,
        crash,
        tracing,
        mcp,
        ..
    } = desk;
    if call.cmd == "bridge_call" {
        let named = call.args.get("caller").and_then(Value::as_str);
        let caller = sender
            .caller(named)
            .ok_or("this page may not use the bridge")?;
        let request: BridgeRequest =
            serde_json::from_value(call.args.get("request").cloned().unwrap_or(Value::Null))
                .map_err(|why| format!("not a bridge request: {why}"))?;
        let response = core.handle(&caller, request);
        return serde_json::to_value(response).map_err(|why| why.to_string());
    }
    if !sender.may_command() {
        return Err(format!("{} is the shell's own command", call.cmd));
    }
    let text = |name: &str| {
        call.args
            .get(name)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    match call.cmd.as_str() {
        "desk_ready" => Ok(json!(desk_boot::ready::ready(
            &text("status"),
            tracing,
            start,
            mcp
        ))),
        "desk_start" => Ok(start.info()),
        "desk_relaunch" => {
            desk_boot::start::relaunch(|| {});
            Ok(Value::Null)
        }
        "desk_trace" => {
            let origin = call
                .args
                .get("origin")
                .and_then(Value::as_f64)
                .unwrap_or_default();
            let phases: Vec<desk_trace::RuntimePhase> =
                serde_json::from_value(call.args.get("phases").cloned().unwrap_or(Value::Null))
                    .map_err(|why| format!("not start-up phases: {why}"))?;
            tracing.runtime(origin, &phases);
            Ok(Value::Null)
        }
        "take_open_files" => {
            let mut opened = desk.opened.lock().unwrap_or_else(|e| e.into_inner());
            Ok(json!(std::mem::take(&mut *opened)))
        }
        "desk_crash" => Ok(json!(crash.record(&text("message"), &text("stack")))),
        "take_last_crash" => Ok(crash.take_last().unwrap_or(Value::Null)),
        other => Err(format!("the CEF shell has no command {other} yet")),
    }
}

/// Hand `text` to `frame`'s page on CEF's UI thread.
pub fn send(frame: Frame, text: String) {
    let mut task = SendTask::new(frame, text);
    post_task(ThreadId::UI, Some(&mut task));
}

wrap_task! {
    struct SendTask {
        frame: Frame,
        text: String,
    }

    impl Task {
        fn execute(&self) {
            if self.frame.is_valid() != 1 {
                return;
            }
            if let Some(mut message) = process_message_create(Some(&MESSAGE.into())) {
                if let Some(list) = message.argument_list() {
                    list.set_string(0, Some(&self.text.as_str().into()));
                }
                self.frame.send_process_message(ProcessId::RENDERER, Some(&mut message));
            }
        }
    }
}

/// The page that hears core events: the main window's main frame, once it exists.
#[derive(Clone, Default)]
pub struct EventTarget(Arc<Mutex<Option<Browser>>>);

impl EventTarget {
    pub fn set(&self, browser: Option<Browser>) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = browser;
    }

    fn frame(&self) -> Option<Frame> {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .and_then(|b| b.main_frame())
    }
}

/// Forward every core event to `target` as `bridge://event`, on a thread of its own.
pub fn forward_events(events: std::sync::mpsc::Receiver<Delivery>, target: EventTarget) {
    let spawned = std::thread::Builder::new()
        .name("desk-events".to_owned())
        .spawn(move || {
            for delivery in events {
                if let Some(frame) = target.frame() {
                    send(
                        frame,
                        wire::event("bridge://event", desk_boot::events::payload(delivery)),
                    );
                }
            }
        });
    if let Err(why) = spawned {
        eprintln!("endue Desk: no thread for core events ({why})");
    }
}
