//! The input router: one entry for every event of the compositor's window ([`InputRouter::handle`])
//! and one for what surfaces say back ([`InputRouter::surface_message`]). The pointer goes to the
//! surface under it (`pointer.rs`), keys to the focused surface after the desk's keymap had its say
//! (`keys.rs`), the IME's text to the focused surface (`ime.rs`), drags through the broker
//! (`dnd/`); the cursor, the OS input method's state and the files nobody took come out as [`Out`]s
//! for the shell to apply.

use std::collections::HashMap;
use std::time::Instant;

use desk_surface::generated::CompositorMessage;
use glam::Vec2;

use super::cursor::{CursorChoice, Cursors};
use super::dnd::{Broker, DndOut, DragOverlay};
use super::events::{Input, Modifiers};
use super::ime::Ime;
use super::keymap::{KeyDecision, KeyLike, Keymap, Platform};
use super::pointer::{Pointer, PointerSettings};
use super::targets::Targets;
use crate::scene::Scene;
use crate::types::Rect;

/// What the shell does after an event.
#[derive(Clone, Debug, PartialEq)]
pub enum Out {
    /// A message for a surface's host.
    Send(CompositorMessage),
    /// A key the desk's keymap takes while `surface` has the focus: the runtime runs it as a key of
    /// that surface's, and the surface never hears it.
    DeskKey {
        surface: String,
        key: KeyLike,
        decision: KeyDecision,
    },
    Cursor(CursorChoice),
    /// Turn the OS input method on or off.
    ImeAllowed(bool),
    /// Where the OS puts its candidate window, in screen pixels.
    ImeArea(Rect),
    /// The OS input method drops what it composed (the focus moved on).
    ImeReset,
    /// Files dropped from the OS that no surface took.
    OpenFiles(Vec<String>),
    /// What the compositor draws itself changed: the focus ring, the drag image.
    Redraw,
}

/// Routes input to surfaces. Every field is the router's own; the shell reads them through methods.
pub struct InputRouter {
    pub targets: Targets,
    pub keymap: Keymap,
    pub(super) settings: PointerSettings,
    pub(super) pointer: Pointer,
    pub(super) mods: Modifiers,
    pub(super) focus: Option<String>,
    pub(super) window_focused: bool,
    pub(super) ime: Ime,
    pub(super) ime_allowed: bool,
    ime_area: Option<Rect>,
    pub(super) cursors: Cursors,
    pub(super) broker: Broker,
    /// Keys down, by code: the surface that heard the press, or none when the desk took it.
    pub(super) keys_down: HashMap<String, Option<String>>,
    hovered: Vec<String>,
    dropped: Vec<String>,
    epoch: Instant,
}

impl InputRouter {
    pub fn new(platform: Platform, settings: PointerSettings) -> InputRouter {
        InputRouter {
            targets: Targets::default(),
            keymap: Keymap::new(platform),
            settings,
            pointer: Pointer::default(),
            mods: Modifiers::default(),
            focus: None,
            window_focused: true,
            ime: Ime::default(),
            ime_allowed: false,
            ime_area: None,
            cursors: Cursors::default(),
            broker: Broker::default(),
            keys_down: HashMap::new(),
            hovered: Vec::new(),
            dropped: Vec::new(),
            epoch: Instant::now(),
        }
    }

    pub(super) fn millis(&self, now: Instant) -> u64 {
        now.saturating_duration_since(self.epoch).as_millis() as u64
    }

    /// One event of the window.
    pub fn handle(&mut self, scene: &Scene, input: &Input, now: Instant) -> Vec<Out> {
        let mut out = Vec::new();
        if !matches!(input, Input::FileHovered { .. } | Input::FileDropped { .. }) {
            out.extend(self.files(scene, now));
        }
        let before = (self.focus.clone(), self.broker.overlay());
        match input {
            Input::PointerMoved { x, y } => {
                let at = Vec2::new(*x, *y);
                if self.broker.active() {
                    self.pointer.at = at;
                    let dnd = self.broker.hover(scene, &self.targets, at, self.mods);
                    out.extend(dnd_outs(dnd));
                } else {
                    let moved =
                        self.pointer
                            .moved(scene, &self.targets, at, self.mods, &self.settings);
                    out.extend(moved.into_iter().map(Out::Send));
                }
            }
            Input::PointerButton { button, pressed } => {
                out.extend(self.button(scene, *button, *pressed, now));
            }
            Input::Wheel { dx, dy, unit } if !self.broker.active() => {
                let wheel = self
                    .pointer
                    .wheel(scene, &self.targets, (*dx, *dy), *unit, self.mods);
                out.extend(wheel.into_iter().map(Out::Send));
            }
            Input::Wheel { .. } => {}
            Input::PointerLeft => out.extend(self.pointer.left().into_iter().map(Out::Send)),
            Input::Modifiers(mods) => {
                self.mods = *mods;
                if self.broker.active() {
                    let at = self.pointer.at;
                    out.extend(dnd_outs(self.broker.hover(scene, &self.targets, at, *mods)));
                }
            }
            Input::Key(key) => out.extend(self.key(key, now)),
            Input::Ime(ime) => {
                let focus = self.focus.clone();
                out.extend(
                    self.ime
                        .input(focus.as_deref(), ime)
                        .into_iter()
                        .map(Out::Send),
                );
            }
            Input::FileHovered { path } => self.hovered.push(path.clone()),
            Input::FileDropped { path } => self.dropped.push(path.clone()),
            Input::FileHoverCancelled => {
                if self.broker.from_os() {
                    out.extend(dnd_outs(self.broker.cancel()));
                }
            }
            Input::WindowFocused { focused } => out.extend(self.window_focus(*focused)),
        }
        out.extend(self.settle(scene, before));
        out
    }

    fn button(
        &mut self,
        scene: &Scene,
        button: super::events::Button,
        pressed: bool,
        now: Instant,
    ) -> Vec<Out> {
        let mut out = Vec::new();
        if self.broker.active() && !pressed && self.pointer.held == [button] {
            let at = self.pointer.at;
            out.extend(dnd_outs(self.broker.release(
                scene,
                &self.targets,
                at,
                self.mods,
                now,
            )));
        }
        if pressed {
            out.extend(self.ime.finish().into_iter().map(Out::Send));
        }
        let (messages, pressed_on) = self.pointer.button(
            scene,
            &self.targets,
            button,
            pressed,
            self.mods,
            now,
            &self.settings,
        );
        out.extend(messages.into_iter().map(Out::Send));
        if let Some(surface) = pressed_on {
            if !self.keymap.pending().is_empty() {
                self.keymap.cancel();
            }
            out.extend(self.focus(Some(&surface)));
        }
        out
    }

    /// The files an OS drag carries arrive one event each, all at once: they enter, or land,
    /// together.
    fn files(&mut self, scene: &Scene, now: Instant) -> Vec<Out> {
        let mut out = Vec::new();
        let at = self.pointer.at;
        if !self.hovered.is_empty() {
            let paths = std::mem::take(&mut self.hovered);
            out.extend(dnd_outs(self.broker.enter_os(
                scene,
                &self.targets,
                paths,
                at,
                self.mods,
            )));
        }
        if !self.dropped.is_empty() {
            let paths = std::mem::take(&mut self.dropped);
            if !self.broker.from_os() {
                out.extend(dnd_outs(self.broker.enter_os(
                    scene,
                    &self.targets,
                    paths,
                    at,
                    self.mods,
                )));
            }
            out.extend(dnd_outs(self.broker.release(
                scene,
                &self.targets,
                at,
                self.mods,
                now,
            )));
        }
        out
    }

    /// Time passed: a release waiting for its answer, a prefix's timeout, an IME's cleared text,
    /// files that arrived.
    pub fn tick(&mut self, scene: &Scene, now: Instant) -> Vec<Out> {
        let before = (self.focus.clone(), self.broker.overlay());
        let mut out = self.files(scene, now);
        out.extend(dnd_outs(self.broker.tick(&self.targets, now)));
        let ms = self.millis(now);
        self.keymap.tick(ms);
        out.extend(self.ime.flush().into_iter().map(Out::Send));
        out.extend(self.settle(scene, before));
        out
    }

    /// After every event: the cursor, the OS input method and a redraw, when they changed.
    pub(super) fn settle(
        &mut self,
        scene: &Scene,
        before: (Option<String>, Option<DragOverlay>),
    ) -> Vec<Out> {
        let mut out = Vec::new();
        let drag = self.broker.effect().filter(|_| !self.broker.from_os());
        let pointer_for = self
            .pointer
            .capture
            .clone()
            .or_else(|| self.pointer.hearing.first().cloned());
        if let Some(cursor) = self.cursors.update(pointer_for.as_deref(), drag) {
            out.push(Out::Cursor(cursor));
        }
        let allowed = self.window_focused && self.ime.allowed(self.focus.as_deref());
        if allowed != self.ime_allowed {
            self.ime_allowed = allowed;
            out.push(Out::ImeAllowed(allowed));
        }
        let area = self.ime.area(scene, &self.targets, self.focus.as_deref());
        if area.is_some() && area != self.ime_area {
            self.ime_area = area;
            out.extend(area.map(Out::ImeArea));
        }
        if (self.focus.clone(), self.broker.overlay()) != before {
            out.push(Out::Redraw);
        }
        out
    }

    /// The surface with the keyboard focus.
    pub fn focused(&self) -> Option<&str> {
        self.focus.as_deref()
    }

    pub fn window_focused(&self) -> bool {
        self.window_focused
    }

    /// The drag image the compositor draws now.
    pub fn overlay(&self) -> Option<DragOverlay> {
        self.broker.overlay()
    }

    /// The cursor the window shows.
    pub fn cursor(&self) -> Option<&CursorChoice> {
        self.cursors.shown()
    }

    /// Whether the OS input method is on, and where its candidate window goes.
    pub fn ime_state(&self) -> (bool, Option<Rect>, Option<(&str, &str)>) {
        (self.ime_allowed, self.ime_area, self.ime.composing())
    }

    /// The surface a press holds, and who hears the pointer now.
    pub fn pointer_state(&self) -> (Option<&str>, &[String], Vec2) {
        (
            self.pointer.capture.as_deref(),
            &self.pointer.hearing,
            self.pointer.at,
        )
    }

    /// The drag broker, for checks.
    pub fn broker(&self) -> &Broker {
        &self.broker
    }
}

pub(super) fn dnd_outs(dnd: Vec<DndOut>) -> Vec<Out> {
    dnd.into_iter()
        .map(|d| match d {
            DndOut::Send(m) => Out::Send(m),
            DndOut::Open(paths) => Out::OpenFiles(paths),
        })
        .collect()
}
