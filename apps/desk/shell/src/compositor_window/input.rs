//! Input in compositor mode (#56): one entry, [`CompositorWindow::input`], for every event the
//! window hears (winit's, turned into `desk_compositor::input::Input` by `winit_input.rs`) and for
//! the ones a check feeds (`harness.rs`). The router decides where each goes; this applies what it
//! says: protocol messages to the page's browser or to a plugin surface's (the web host), keys the
//! desk's keymap takes to the runtime as the focused frame's (`desk:key` from its surface, as
//! the SDK forwarded them in Stage 1), the cursor and the OS input method to the window, files from
//! the OS nobody took to the open-files queue. The keys follow the window in use (ADR 0192), which
//! the window manager decides (`focus.rs`, ADR 0230): the router hears its surface in use and the
//! windows that cover what lies under them, and from the page only what its own fields hold.

use std::time::Instant;

use cef::ImplBrowser;
use desk_compositor::input::keymap::{KeyEntry, KeyLike, Platform};
use desk_compositor::input::{Input, Out, PageFocus};
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
use crate::web_host::{web_rules, window_pages};

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
        crate::frame_trace::input(&input);
        // A press lands on the desk as it is now. When the desk changed since the scene was last
        // laid out (the page took a desk, a window glided on), the scene the router hit-tests, and
        // where the window manager learns the page hears the press, is laid out first. Else a
        // press right after the page took a desk went where the page had laid the window out
        // before: onto nothing, or onto a grip (#139).
        if matches!(input, Input::PointerButton { pressed: true, .. }) && self.shared.lock().dirty {
            self.compose();
        }
        self.tip_input(&input);
        self.edge_input(&input);
        // A press on a popup widget, and what follows it, is its surface's alone (#156).
        let popup = self.popup_input(&input);
        if !popup && self.wm_input(&input) {
            return;
        }
        // What the window manager decided for this press reached the router first (`focus.rs`).
        let mut outs = self.focus_outs();
        let routed = self.router.handle(&self.scene, &input, Instant::now());
        outs.extend(if popup {
            Self::popup_outs(routed)
        } else {
            routed
        });
        self.web_pressed(&outs);
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
        self.tell_focus();
        let mut outs = self.focus_outs();
        outs.extend(self.router.tick(&self.scene, Instant::now()));
        self.apply(event_loop, outs);
    }

    pub(super) fn apply(&mut self, event_loop: &ActiveEventLoop, outs: Vec<Out>) {
        for out in outs {
            if let Some(Out::Cursor(choice)) = self.apply_now(out) {
                self.cursors.show(&self.window, event_loop, &choice);
            }
        }
    }

    /// Apply `out` where the event loop is not at hand (a page's call, the window manager's
    /// change); a cursor needs the loop and comes back.
    pub(super) fn apply_now(&mut self, out: Out) -> Option<Out> {
        match out {
            Out::Send(message) => self.deliver(&message),
            Out::DeskKey { surface, key, .. } => self.desk_key(&surface, &key),
            Out::Cursor(_) => return Some(out),
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
            Out::HandOff { paths, allowed } => self.hand_off(&paths, &allowed),
            Out::Redraw => self.shared.lock().dirty = true,
        }
        None
    }

    /// A desk drag of `paths` left the window: the OS drags them now, and says how it ended (#309).
    fn hand_off(
        &mut self,
        paths: &[String],
        allowed: &[desk_surface::generated::SurfaceDropEffect],
    ) {
        let home = crate::paths::home_dir();
        let local: Vec<std::path::PathBuf> = paths
            .iter()
            .map(|p| crate::os_dnd::local_path(p, &home))
            .collect();
        let pump = self.desk.pump.clone();
        crate::os_dnd::hand_off(&self.window, &local, allowed, move |effect| {
            pump.run(move |shell, event_loop| {
                if let Some(compositor) = shell.compositor.as_mut() {
                    compositor.input(event_loop, Input::HandOffEnded { effect });
                }
            });
        });
    }

    /// A protocol message to its surface: the page's browser, or a plugin surface's.
    fn deliver(&mut self, message: &CompositorMessage) {
        let Some(surface) = surface_of(message) else {
            return;
        };
        if let CompositorMessage::SurfaceDragDrop(drop) = message
            && drop.person_dropped == Some(true)
            && let Some(owner) = self.router.targets.owner(&surface)
        {
            let paths = drop
                .items
                .iter()
                .filter_map(|item| match item {
                    desk_surface::generated::SurfaceDragItem::SurfaceDragPaths(paths) => {
                        Some(&paths.paths)
                    }
                    _ => None,
                })
                .flatten()
                .map(|path| path.path.as_str());
            let target = drop.destination.as_ref().filter(|_| {
                !matches!(
                    drop.effect,
                    desk_surface::generated::SurfaceDropEffect::Link
                )
            });
            self.desk.core.grant_file_drop(
                drop.source.as_deref(),
                owner,
                paths,
                target.map(|folder| folder.path.as_str()),
            );
        }
        // A window's own page has the engine's focus while it has the keys (ADR 0201): a field
        // there shows its caret.
        if window_pages::is_window_page(&surface) {
            match message {
                CompositorMessage::SurfaceFocusIn(_) => self.host.window_page_focus(&surface, true),
                CompositorMessage::SurfaceFocusOut(_) => {
                    self.host.window_page_focus(&surface, false)
                }
                _ => {}
            }
        }
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
        // A web view's keys are its window's plugin's to the runtime (ADR 0216).
        let surface = web_rules::host_of(surface).unwrap_or(surface);
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
        // Windows out of the canvas ask the same keymap before their pages hear a key (#235).
        let known = report.known.as_deref();
        crate::app_windows::report_keys(platform, &report.entries, known, report.timeout);
    }

    /// The page says what its own fields hold: an element of its own has its focus (`own`), the
    /// place of a surface it shows outside every window has (ADR 0160), or neither, where the keys
    /// are the window in use's. Its focus on a window's surface decides nothing (ADR 0230). An
    /// `answer` to a press on the page or a key the desk ran sends on what was typed since, once
    /// the keys are where the window manager has the window in use now.
    pub fn page_focus(
        &mut self,
        event_loop: &ActiveEventLoop,
        surface: Option<String>,
        own: bool,
        answer: bool,
    ) {
        let made = self.hosted.surfaces().made();
        // A plugin surface's place, or a window's own page with a field of its own focused (ADR 0201).
        let known = |s: &String| {
            made.iter().any(|(host, _, _)| host == s)
                || (window_pages::is_window_page(s) && self.host.browser(s).is_some())
        };
        let surface = surface.filter(known);
        let said = match surface {
            Some(surface) => PageFocus::Place(self.host.web_stand_in(&surface)),
            None if own => PageFocus::Own,
            None => PageFocus::Rest,
        };
        // A desk key pressed in a window out of the canvas opened something of the page's own
        // (⌘K's palette): the desk comes forward to show it (#235).
        if said == PageFocus::Own && crate::app_windows::desk_key_lately() {
            self.desk
                .pump
                .run(|shell, _| crate::palette::reveal_main(shell));
        }
        let mut outs = self.router.page_focus(said);
        if answer {
            self.tell_focus();
            outs.extend(self.focus_outs());
            outs.extend(self.router.page_answered(Instant::now()));
        }
        self.apply(event_loop, outs);
    }

    /// Tell the router what each node shows and the window's own page each surface lies in (ADR
    /// 0201), and draw the drag image (#56). No ring goes round the pane with the keys: the frame of
    /// the window in use says which window has them.
    pub(super) fn register(&mut self, shown: Shown, pages: &[(String, String)]) {
        let router = &mut self.router;
        router.targets.clear();
        for (node, target) in shown {
            // A window page drawn from its last picture, its page replaced (`popup_room.rs`): the
            // pointer goes to the desk's page under it, which holds the window again meanwhile.
            if window_pages::is_window_page(&target.surface)
                && self.host.browser(&target.surface).is_none()
            {
                continue;
            }
            if let Some((plugin, _)) = owner(&target.surface) {
                router.targets.set_owner(&target.surface, &plugin);
            }
            router.targets.surface(&self.scene, node, target);
        }
        for (surface, page) in pages {
            router.targets.set_page_of(surface, page);
        }
        let scale = self.window.scale_factor() as f32;
        let mut made = self.hosted.surfaces().made();
        // A web view lies in its plugin's window, and covers what is under it there.
        let views: Vec<_> = (made.iter())
            .filter(|(host, _, _)| router.targets.shown(&web_rules::surface_of(host)))
            .map(|(host, plugin, _)| (web_rules::surface_of(host), plugin.clone(), false))
            .collect();
        made.extend(views);
        // Each window covers what lies under it (issue 159, finding 5); not on the spread's cards.
        if let Some(plan) = self.hosted.plan().filter(|_| self.spreading.open.is_none()) {
            let popups = &self.gestures.popups.boxes;
            let areas = popup_input::areas(&plan.windows, &made, popups, scale);
            router.targets.set_areas(PAGE, areas);
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
            "inUse": self.focus_state(),
            "windowFocused": self.router.window_focused(),
            "cursor": format!("{:?}", self.cursors.shown(self.router.cursor())),
            "ime": { "allowed": allowed, "area": area.map(|r| [r.x, r.y, r.width, r.height]),
                "composing": composing.map(|(s, t)| json!({ "surface": s, "text": t })) },
            "pointer": { "capture": capture, "hearing": hearing, "at": [at.x, at.y] },
            "drag": { "active": broker.active(), "fromOs": broker.from_os(), "over": broker.over(),
                "effect": broker.effect(), "settling": broker.settling(), "overlay": overlay },
            "keys": { "pending": self.router.keymap.pending(), "bound": self.router.keymap.bindings().len(),
                "holding": self.router.holding() },
            "tooltip": self.tips.state(self.window.scale_factor() as f32),
            "panning": self.gestures.panning.running(self.pointer_css(), Instant::now()),
            "scale": self.window.scale_factor(),
        })
    }
}

#[path = "popup_input.rs"]
pub(super) mod popup_input;
