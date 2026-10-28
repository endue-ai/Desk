//! Frames: OS windows, each running its own runtime, like Emacs frames over one Emacs. `main` is the
//! first; the others are `frame-<n>`. Core events reach the frame that made the call that started
//! them (ADR 0018); events nobody owns go to every frame.

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use desk_bridge::{BridgeEvent, BridgeResponse};
use desk_core::{Delivery, FrameRouter};
use tauri::{AppHandle, Emitter, EventTarget, Manager, WebviewWindow, WebviewWindowBuilder};

pub const MAIN: &str = "main";
/// The Tauri event the runtime listens to for core events.
pub const EVENT: &str = "bridge://event";

static NEXT: AtomicU64 = AtomicU64::new(2);

/// Open a frame with the main window's settings. `label` defaults to the next `frame-<n>`.
pub fn open(app: &AppHandle, label: Option<&str>) -> tauri::Result<WebviewWindow> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN)
        .cloned()
        .unwrap_or_default();
    config.label = match label {
        Some(label) => label.to_owned(),
        None => loop {
            let candidate = format!("frame-{}", NEXT.fetch_add(1, Ordering::Relaxed));
            if app.get_webview_window(&candidate).is_none() {
                break candidate;
            }
        },
    };
    WebviewWindowBuilder::from_config(app, &config)?.build()
}

/// Bring Desk forward: focus a frame, or open `main` when none is left.
pub fn show(app: &AppHandle) {
    let existing = app.webview_windows().into_values().next();
    let window = match existing {
        Some(window) => Some(window),
        None => open(app, Some(MAIN)).ok(),
    };
    if let Some(window) = window {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The open frames' labels, `main` first.
pub fn labels(app: &AppHandle) -> Vec<String> {
    let mut labels: Vec<String> = app.webview_windows().into_keys().collect();
    labels.sort_by_key(|label| (label != MAIN, label.clone()));
    labels
}

/// Core events, delivered per frame.
pub struct Routing {
    router: Mutex<FrameRouter>,
}

impl Routing {
    pub fn new() -> Self {
        Self {
            router: Mutex::new(FrameRouter::new()),
        }
    }

    /// Deliver one core event. Emitting under the lock keeps each frame's events in order.
    pub fn deliver(&self, app: &AppHandle, event: &BridgeEvent) {
        let mut router = self.lock();
        match router.route(event) {
            Delivery::All => {
                let _ = app.emit(EVENT, event);
            }
            Delivery::To(frame) => emit_to(app, &frame, event),
            Delivery::Held => {}
        }
    }

    /// `frame`'s call answered: the work it started is the frame's, and early events follow now.
    pub fn claim(&self, app: &AppHandle, frame: &str, method: &str, response: &BridgeResponse) {
        let mut router = self.lock();
        for event in router.claim(frame, method, response) {
            emit_to(app, frame, &event);
        }
    }

    pub fn closed(&self, frame: &str) {
        self.lock().frame_closed(frame);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, FrameRouter> {
        self.router
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn emit_to(app: &AppHandle, frame: &str, event: &BridgeEvent) {
    let _ = app.emit_to(EventTarget::webview_window(frame), EVENT, event);
}
