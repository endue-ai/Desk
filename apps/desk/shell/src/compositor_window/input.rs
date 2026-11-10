//! Input in compositor mode (#56): one entry, [`CompositorWindow::input`], for every event the
//! window hears (winit's, turned into `desk_compositor::input::Input` by `winit_input.rs`) and for
//! the ones a check feeds (`harness.rs`). The router decides where each goes; this applies what it
//! says: protocol messages to the page's browser or to a plugin surface's (the web host), keys the
//! desk's keymap takes to the runtime as the focused frame's (`desk:key` from its surface, as
//! the SDK forwarded them in Stage 1), the cursor and the OS input method to the window, files from
//! the OS nobody took to the open-files queue.

use std::time::Instant;

use cef::ImplBrowser;
use desk_compositor::Rect;
use desk_compositor::input::keymap::{KeyEntry, KeyLike, Platform};
use desk_compositor::input::{Input, Out};
use desk_surface::generated::{CompositorMessage, SurfaceMessage};
use desk_web::sender::Role;
use serde::Deserialize;
use serde_json::{Value, json};
use winit::dpi::{PhysicalPosition, PhysicalSize};
use winit::event_loop::ActiveEventLoop;

use super::draw::Shown;
use super::hosted::owner;
use super::{CompositorWindow, PAGE, os_pointer, overlay};
use crate::web_host::input as web_input;
use crate::web_host::lifecycle::surface_of;

/// The runtime's keymap as the page reports it (`apps/desk/src/compositor-keys.ts`).
#[derive(Debug, Deserialize)]
pub struct KeysReport {
    pub platform: String,
    pub entries: Vec<KeyEntry>,
    /// The commands registered now.
    #[serde(default)]
    pub known: Option<Vec<String>>,
    /// How long a prefix waits, in milliseconds (0: no limit).
    #[serde(default)]
    pub timeout: u64,
}

impl CompositorWindow {
    /// One input event of the window, routed and applied; the window manager hears it first and
    /// may take it whole (Escape cancelling a drag, a card's button).
    pub fn input(&mut self, event_loop: &ActiveEventLoop, input: Input) {
        if self.wm_input(&input) {
            return;
        }
        let outs = self.router.handle(&self.scene, &input, Instant::now());
        self.apply(event_loop, outs);
    }

    /// What surfaces said that input cares about: cursors, text input, carets, drags.
    pub(super) fn surface_said(&mut self, event_loop: &ActiveEventLoop, message: &SurfaceMessage) {
        let outs = self
            .router
            .surface_message(&self.scene, message, Instant::now());
        self.apply(event_loop, outs);
    }

    /// Time passed for input: a drop's answer, a prefix's timeout, files that arrived; an OS drag
    /// follows the OS pointer, which winit does not report during one.
    pub(super) fn input_tick(&mut self, event_loop: &ActiveEventLoop) {
        if self.follow_os_pointer
            && self.router.broker().from_os()
            && let Some((x, y)) = os_pointer::position(&self.window)
        {
            let (x, y) = (x as f32, y as f32);
            if self.router.pointer_state().2 != desk_compositor::glam::Vec2::new(x, y) {
                self.input(event_loop, Input::PointerMoved { x, y });
            }
        }
        let outs = self.router.tick(&self.scene, Instant::now());
        self.apply(event_loop, outs);
    }

    pub(super) fn apply(&mut self, event_loop: &ActiveEventLoop, outs: Vec<Out>) {
        for out in outs {
            match out {
                Out::Send(message) => self.deliver(&message),
                Out::DeskKey { surface, key, .. } => self.desk_key(&surface, &key),
                Out::Cursor(choice) => self.cursors.show(&self.window, event_loop, &choice),
                Out::ImeAllowed(allowed) => self.window.set_ime_allowed(allowed),
                Out::ImeArea(r) => self.window.set_ime_cursor_area(
                    PhysicalPosition::new(f64::from(r.x), f64::from(r.y)),
                    PhysicalSize::new(f64::from(r.width), f64::from(r.height)),
                ),
                Out::ImeReset => {
                    // Off and on again: the OS input method drops what it composed.
                    self.window.set_ime_allowed(false);
                    self.window.set_ime_allowed(self.router.ime_state().0);
                }
                Out::OpenFiles(paths) => {
                    if self.desk.opened.push(paths) {
                        let event = crate::open_files::EVENT;
                        self.desk.pages.emit(Role::Main, event, Value::Null);
                    }
                }
                Out::Redraw => self.shared.lock().dirty = true,
            }
        }
    }

    /// A protocol message to its surface: the page's browser, or a plugin surface's.
    fn deliver(&mut self, message: &CompositorMessage) {
        let Some(surface) = surface_of(message) else {
            return;
        };
        if surface != PAGE {
            self.send_to(message);
            return;
        }
        let Some(host) = self.browser.as_ref().and_then(|b| b.host()) else {
            return;
        };
        match message {
            // The page keeps the engine's focus while the window has the OS's: its surfaces' places
            // take the DOM's focus there, and the runtime follows that to raise its windows.
            CompositorMessage::SurfaceFocusOut(_) if self.router.window_focused() => {}
            _ => {
                let height = f64::from(self.page.lock().size.1);
                web_input::deliver(&host, message, &mut self.page_composing, height);
            }
        }
    }

    /// A key the desk's keymap takes while plugin surface `surface` has the focus: the runtime
    /// hears it from that surface, so it runs with the surface's keys first.
    fn desk_key(&self, surface: &str, key: &KeyLike) {
        let press = json!({ "type": "desk:key", "key": {
            "key": key.key, "code": key.code, "metaKey": key.meta, "ctrlKey": key.ctrl,
            "altKey": key.alt, "shiftKey": key.shift, "repeat": key.repeat } });
        self.relay.up(surface, press.to_string());
    }

    /// The runtime's keymap changed.
    pub fn keys(&mut self, report: KeysReport) {
        let platform = if report.platform == "mac" {
            Platform::Mac
        } else {
            Platform::Other
        };
        if platform != self.router.keymap.platform() {
            self.router.keymap = desk_compositor::input::keymap::Keymap::new(platform);
        }
        self.router
            .keymap
            .apply(&report.entries, report.known.as_deref());
        self.router.keymap.set_timeout(report.timeout);
    }

    /// The page moved the DOM's focus: to a plugin surface's place (ADR 0160), or within itself.
    pub fn page_focus(&mut self, event_loop: &ActiveEventLoop, surface: Option<String>) {
        let made = self.hosted.surfaces().made();
        let surface = surface.filter(|s| made.iter().any(|(host, _, _)| host == s));
        let outs = self.router.focus(Some(surface.as_deref().unwrap_or(PAGE)));
        self.apply(event_loop, outs);
    }

    /// Tell the router what each node shows, and draw the focus ring and the drag image (#56).
    pub(super) fn register(&mut self, shown: Shown) {
        let router = &mut self.router;
        router.targets.clear();
        for (node, target) in shown {
            if let Some((plugin, _)) = owner(&target.surface) {
                router.targets.set_owner(&target.surface, &plugin);
            }
            router.targets.surface(&self.scene, node, target);
        }
        let scale = self.window.scale_factor() as f32;
        let focused = router.focused().filter(|s| *s != PAGE).map(str::to_owned);
        // The ring goes round the pane the focused surface shows in, while it is drawn.
        // Not while the spread is open: the pane is on a card, not where the ring would go.
        let spreading = self.spreading.open.is_some();
        let ring = focused
            .filter(|s| !spreading && router.window_focused() && router.targets.shown(s))
            .and_then(|s| {
                let plugin = owner(&s)?.0;
                let plan = self.hosted.plan()?;
                let pane = plan.panes_of(&plugin).last()?;
                Some(pane.body)
            });
        if let Some(r) = ring {
            let device = Rect::new(
                r.x as f32 * scale,
                r.y as f32 * scale,
                r.w as f32 * scale,
                r.h as f32 * scale,
            );
            overlay::focus_ring(&mut self.scene, device.round_out(), scale);
        }
        if let Some(drag) = router.overlay() {
            overlay::drag_image(&mut self.scene, &drag, scale);
        }
    }

    /// The router's state, for checks (development builds).
    pub fn input_state(&self) -> Value {
        let (allowed, area, composing) = self.router.ime_state();
        let (capture, hearing, at) = self.router.pointer_state();
        let broker = self.router.broker();
        let overlay = self.router.overlay().map(|o| {
            json!({ "label": o.look.label, "count": o.look.count, "at": [o.at.x, o.at.y],
                "caption": overlay::caption(&o) })
        });
        json!({
            "focused": self.router.focused(),
            "windowFocused": self.router.window_focused(),
            "cursor": format!("{:?}", self.router.cursor()),
            "ime": { "allowed": allowed, "area": area.map(|r| [r.x, r.y, r.width, r.height]),
                "composing": composing.map(|(s, t)| json!({ "surface": s, "text": t })) },
            "pointer": { "capture": capture, "hearing": hearing, "at": [at.x, at.y] },
            "drag": { "active": broker.active(), "fromOs": broker.from_os(), "over": broker.over(),
                "effect": broker.effect(), "settling": broker.settling(), "overlay": overlay },
            "keys": { "pending": self.router.keymap.pending(), "bound": self.router.keymap.bindings().len() },
            "scale": self.window.scale_factor(),
        })
    }
}
