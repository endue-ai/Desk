//! The compositor window's accessibility (#57, `specs/surface/v0/accessibility.md`): one AccessKit
//! adapter on the winit window (NSAccessibility, UI Automation, AT-SPI), fed the desk's one tree
//! (`desk_compositor::a11y::DeskA11y`): the chrome as the last scene drew it (`a11y_chrome.rs`) and
//! every surface's tree, the page's included. While an assistive technology is active every surface
//! exports (`a11y.enable`), a native plugin's (#59) as a web one's; what it asks for comes back as
//! an `a11y.action` to a surface, a wheel, a press on the chrome where it is drawn (`input`, as a
//! person's), or the keys to a surface (its place focused in the page, which raises its window
//! as a press would). The adapter's handlers run on whichever thread the OS asks on and reach the
//! window through the pump.

use std::collections::HashSet;

use accesskit::{ActionHandler, ActionRequest, ActivationHandler, DeactivationHandler, TreeUpdate};
use desk_compositor::a11y::{DeskA11y, Request};
use desk_compositor::glam::Vec2;
use desk_compositor::input::{Button, Input, Modifiers, messages};
use desk_surface::generated::{
    CompositorMessage, SurfaceA11yEnable, SurfaceA11yEnableType, SurfaceA11yUpdate,
};
use winit::event::WindowEvent;
use winit::event_loop::ActiveEventLoop;

use super::a11y_chrome::{self, Shown};
use super::{CompositorWindow, PAGE};
use crate::pump::Pump;

/// What the adapter asks the window for.
#[derive(Debug)]
pub enum Asked {
    /// An assistive technology started: the whole tree.
    Tree,
    Action(ActionRequest),
    /// It stopped.
    Gone,
}

/// The window's accessibility.
#[derive(Default)]
pub struct A11y {
    pub desk: DeskA11y,
    adapter: Option<accesskit_winit::Adapter>,
    /// The tree as the adapter has it, for checks (`compositor_a11y`, `a11y_check.rs`).
    pub shadow: Option<accesskit_consumer::Tree>,
    /// What the last scene showed.
    pub shown: Shown,
    /// The surfaces asked to export.
    exporting: HashSet<String>,
    /// What the chrome was last built from: the page tree's revision, the desk's, the focus, and
    /// whether a scene was composed since.
    built: Option<(u64, u64, Option<String>)>,
    pub composed: bool,
}

struct Handler(Pump);

impl Handler {
    fn ask(&self, asked: Asked) {
        self.0.run(move |shell, event_loop| {
            if let Some(c) = shell.compositor.as_mut() {
                c.a11y_asked(event_loop, asked);
            }
        });
    }
}

impl ActivationHandler for Handler {
    fn request_initial_tree(&mut self) -> Option<TreeUpdate> {
        self.ask(Asked::Tree);
        None
    }
}

impl ActionHandler for Handler {
    fn do_action(&mut self, request: ActionRequest) {
        self.ask(Asked::Action(request));
    }
}

impl DeactivationHandler for Handler {
    fn deactivate_accessibility(&mut self) {
        self.ask(Asked::Gone);
    }
}

impl CompositorWindow {
    /// The adapter on the window, which must not have been shown yet.
    pub fn attach_a11y(&mut self, event_loop: &ActiveEventLoop) {
        let pump = self.desk.pump.clone();
        let adapter = accesskit_winit::Adapter::with_direct_handlers(
            event_loop,
            &self.window,
            Handler(pump.clone()),
            Handler(pump.clone()),
            Handler(pump),
        );
        self.a11y.adapter = Some(adapter);
    }

    /// An event of the window: the adapter hears it first (it follows the focus and the size),
    /// then the router, when it is input.
    pub fn window_event(&mut self, event_loop: &ActiveEventLoop, event: &WindowEvent) {
        if let Some(adapter) = self.a11y.adapter.as_mut() {
            adapter.process_event(&self.window, event);
        }
        if let Some(input) = super::winit_input::input_of(event) {
            self.input(event_loop, input);
        }
    }

    /// What the adapter asked.
    pub fn a11y_asked(&mut self, event_loop: &ActiveEventLoop, asked: Asked) {
        match asked {
            Asked::Tree => {
                self.a11y.desk.activate();
                self.a11y.shadow = None;
                self.a11y.built = None;
                // A scene composed now says where every surface is drawn.
                self.compose();
                self.a11y_tick();
            }
            Asked::Action(request) => self.a11y_request(event_loop, &request),
            Asked::Gone => self.a11y_off(),
        }
    }

    /// No assistive technology any more: the surfaces stop exporting.
    pub(super) fn a11y_off(&mut self) {
        self.a11y.desk.deactivate();
        self.a11y.shadow = None;
        for surface in std::mem::take(&mut self.a11y.exporting) {
            self.send_to(&enable(&surface, false));
        }
    }

    /// A surface's tree changed.
    pub(super) fn a11y_update(&mut self, update: SurfaceA11yUpdate) {
        self.a11y.desk.update(update);
    }

    /// A scene was composed: what it showed, while the desk is active.
    pub(super) fn a11y_drawn(&mut self, drawn: &super::draw::Drawn) {
        if self.a11y.desk.is_active() {
            let scale = self.window.scale_factor() as f32;
            self.a11y.shown = a11y_chrome::shown(&self.scene, &drawn.shown, &drawn.buttons, scale);
            self.a11y.shown.spread = drawn.spread.clone();
            self.a11y.composed = true;
        }
    }

    /// After every look: the surfaces export while the desk is active, the chrome is the last
    /// scene's, and what changed goes to the adapter.
    pub(super) fn a11y_tick(&mut self) {
        if !self.a11y.desk.is_active() {
            return;
        }
        let made = self.hosted.surfaces().made();
        let mut now: HashSet<String> = made.iter().map(|(host, _, _)| host.clone()).collect();
        now.insert(PAGE.to_owned());
        // A web surface says whether it exports (a new browser of its starts over); a native
        // plugin's process (#59) is asked once, when its surface comes.
        for surface in &now {
            let off = self.host.a11y_exports(surface) == Some(false);
            let new = !self.a11y.exporting.contains(surface) && self.native.owns(surface);
            if off || new {
                self.send_to(&enable(surface, true));
            }
        }
        for gone in self.a11y.exporting.difference(&now) {
            self.a11y.desk.forget(gone);
        }
        self.a11y.exporting = now;
        for (host, _, asleep) in &made {
            let away = *asleep || self.hosted.surfaces().dead(host);
            self.a11y.desk.set_unavailable(host, away);
        }
        let focus = self.router.focused().map(str::to_owned);
        let page = self.a11y.desk.tree(PAGE);
        let key = (
            page.map_or(0, |t| t.revision()),
            self.hosted.seq(),
            focus.clone(),
        );
        if std::mem::take(&mut self.a11y.composed) || self.a11y.built.as_ref() != Some(&key) {
            let scale = self.window.scale_factor();
            let chrome = a11y_chrome::chrome(
                &self.hosted,
                &self.a11y.shown,
                page,
                scale,
                focus.as_deref(),
            );
            self.a11y.desk.set_chrome(chrome);
            self.a11y.built = Some(key);
        }
        let updates = self.a11y.desk.flush();
        self.a11y_send(updates);
    }

    /// Hand `updates` to the adapter, and to the checks' copy of its tree.
    pub(super) fn a11y_send(&mut self, updates: Vec<TreeUpdate>) {
        for update in updates {
            if let Some(adapter) = self.a11y.adapter.as_mut() {
                let sent = update.clone();
                adapter.update_if_active(|| sent);
            }
            match self.a11y.shadow.as_mut() {
                Some(tree) => tree.update_and_process_changes(update, &mut Quiet),
                // Development builds keep the checks' copy; a release build feeds the adapter only.
                None if cfg!(debug_assertions)
                    && update.tree.is_some()
                    && update.tree_id == accesskit::TreeId::ROOT =>
                {
                    self.a11y.shadow = Some(accesskit_consumer::Tree::new(update, true));
                }
                None => {}
            }
        }
    }

    /// Do what an assistive technology asked.
    pub(super) fn a11y_request(&mut self, event_loop: &ActiveEventLoop, request: &ActionRequest) {
        for asked in self.a11y.desk.request(request) {
            match asked {
                Request::Surface(action) => {
                    self.send_to(&CompositorMessage::SurfaceA11yAction(action));
                }
                Request::Wheel {
                    surface,
                    at,
                    delta,
                    unit,
                } => {
                    let at = Vec2::new(at.0 as f32, at.1 as f32);
                    let wheel =
                        messages::pointer_wheel(&surface, at, delta, unit, Modifiers::default());
                    self.a11y_input(&surface, &wheel);
                }
                Request::Press { at } => {
                    let scale = self.window.scale_factor() as f32;
                    let (x, y) = (at.0 * scale, at.1 * scale);
                    self.input(event_loop, Input::PointerMoved { x, y });
                    for pressed in [true, false] {
                        let press = Input::PointerButton {
                            button: Button::Left,
                            pressed,
                        };
                        self.input(event_loop, press);
                    }
                }
                Request::Focus { surface } => self.a11y_focus(event_loop, &surface),
            }
        }
        self.shared.lock().dirty = true;
    }

    /// Input for a surface or the page, as the router would deliver it.
    fn a11y_input(&mut self, surface: &str, message: &CompositorMessage) {
        if surface != PAGE {
            self.send_to(message);
            return;
        }
        if let Some(host) = self.browser.as_ref().and_then(cef::ImplBrowser::host) {
            let height = f64::from(self.page.lock().size.1);
            crate::web_host::input::deliver(&host, message, &mut self.page_composing, height);
        }
    }

    /// The keys to surface `surface`: its place takes the page's focus, so the runtime raises its
    /// window as for a press (`Surface.ts`'s `focusin`), and the router gives it the keys.
    fn a11y_focus(&mut self, event_loop: &ActiveEventLoop, surface: &str) {
        if surface != PAGE
            && let Some(frame) = self.browser.as_ref().and_then(cef::ImplBrowser::main_frame)
        {
            let host = serde_json::to_string(surface).unwrap_or_default();
            let script = format!(
                "(() => {{ const host = {host}; for (const p of document.querySelectorAll('[data-surface-host]')) \
                 if (p.dataset.surfaceHost === host) {{ p.focus(); break; }} }})()"
            );
            cef::ImplFrame::execute_java_script(&frame, Some(&script.as_str().into()), None, 0);
        }
        let outs = self.router.focus(Some(surface));
        self.apply(event_loop, outs);
    }
}

struct Quiet;

impl accesskit_consumer::TreeChangeHandler for Quiet {
    fn node_added(&mut self, _: &accesskit_consumer::NodeRef) {}
    fn node_updated(&mut self, _: &accesskit_consumer::NodeRef, _: &accesskit_consumer::NodeRef) {}
    fn focus_moved(
        &mut self,
        _: Option<&accesskit_consumer::NodeRef>,
        _: Option<&accesskit_consumer::NodeRef>,
    ) {
    }
    fn node_removed(&mut self, _: &accesskit_consumer::NodeRef) {}
}

/// `a11y.enable` for `surface`.
fn enable(surface: &str, enabled: bool) -> CompositorMessage {
    CompositorMessage::SurfaceA11yEnable(SurfaceA11yEnable {
        r#type: SurfaceA11yEnableType::A11yEnable,
        surface: surface.to_owned(),
        enabled,
    })
}
