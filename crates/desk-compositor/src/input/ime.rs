//! Input methods (`specs/surface/v0/ime.md`): the OS input method belongs to the compositor's
//! window, the text to the focused surface. What the IME composes goes to that surface as
//! `ime.composition`, then `ime.commit`; an empty composition is never sent (`ime.cancel` instead).
//! The OS IME is on only while the focused surface last said `ime.enabled: true`. The surface's caret
//! (and each composed character's box) comes back in its own pixels; mapped to the screen it places
//! the OS candidate window. A composition the focus or a press leaves behind is committed as it is.

use std::collections::HashMap;

use desk_surface::generated::{CompositorMessage, SurfaceRect};
use glam::Vec2;

use super::events::ImeInput;
use super::messages as msg;
use super::targets::Targets;
use crate::scene::Scene;
use crate::types::Rect;

#[derive(Clone, Debug, Default)]
pub struct Ime {
    enabled: HashMap<String, bool>,
    /// The surface composing and its text so far.
    composing: Option<(String, String)>,
    /// The IME cleared its text: a commit may follow at once; anything else cancels.
    clearing: bool,
    carets: HashMap<String, (SurfaceRect, Vec<SurfaceRect>)>,
}

impl Ime {
    /// Surface `surface` takes text now, or no longer.
    pub fn set_enabled(&mut self, surface: &str, enabled: bool) {
        self.enabled.insert(surface.to_owned(), enabled);
    }

    /// Whether the OS IME should be on, for `focused`.
    pub fn allowed(&self, focused: Option<&str>) -> bool {
        focused.is_some_and(|s| self.enabled.get(s).copied().unwrap_or(false))
    }

    /// The text being composed, and for which surface.
    pub fn composing(&self) -> Option<(&str, &str)> {
        self.composing
            .as_ref()
            .map(|(s, t)| (s.as_str(), t.as_str()))
    }

    /// What the IME said, for the focused surface.
    pub fn input(&mut self, focused: Option<&str>, ime: &ImeInput) -> Vec<CompositorMessage> {
        let mut out = Vec::new();
        if !matches!(ime, ImeInput::Commit { .. }) {
            out.extend(self.flush());
        }
        let Some(surface) = focused else {
            self.composing = None;
            return out;
        };
        match ime {
            ImeInput::Enabled => {}
            ImeInput::Preedit { text, .. } if text.is_empty() => {
                self.clearing = self.composing.is_some();
            }
            ImeInput::Preedit { text, cursor } => {
                let (start, end) = cursor.unwrap_or((text.len(), text.len()));
                let selection = (msg::utf16_at(text, start), msg::utf16_at(text, end));
                self.composing = Some((surface.to_owned(), text.clone()));
                out.push(msg::ime_composition(surface, text, selection));
            }
            ImeInput::Commit { text } => {
                self.clearing = false;
                let was = self.composing.take();
                if !text.is_empty() {
                    out.push(msg::ime_commit(surface, text));
                } else if let Some((s, _)) = was {
                    out.push(msg::ime_cancel(&s));
                }
            }
            ImeInput::Disabled => {
                if let Some((s, _)) = self.composing.take() {
                    out.push(msg::ime_cancel(&s));
                }
            }
        }
        out
    }

    /// An empty composition that no commit followed: it was cancelled.
    pub fn flush(&mut self) -> Vec<CompositorMessage> {
        if !std::mem::take(&mut self.clearing) {
            return Vec::new();
        }
        self.composing
            .take()
            .map(|(s, _)| msg::ime_cancel(&s))
            .into_iter()
            .collect()
    }

    /// The focus moves or a press lands: the composition is committed as it stands.
    pub fn finish(&mut self) -> Vec<CompositorMessage> {
        let mut out = self.flush();
        if let Some((surface, text)) = self.composing.take() {
            out.push(msg::ime_commit(&surface, &text));
        }
        out
    }

    /// The surface's caret and composed characters, in its own pixels.
    pub fn caret(&mut self, surface: &str, caret: SurfaceRect, characters: Vec<SurfaceRect>) {
        self.carets.insert(surface.to_owned(), (caret, characters));
    }

    /// A surface left the desk.
    pub fn forget(&mut self, surface: &str) {
        self.enabled.remove(surface);
        self.carets.remove(surface);
        if self.composing.as_ref().is_some_and(|(s, _)| s == surface) {
            self.composing = None;
        }
    }

    /// Where the OS should put its candidate window for `focused`, in screen pixels: under the last
    /// composed character, else the caret.
    pub fn area(&self, scene: &Scene, targets: &Targets, focused: Option<&str>) -> Option<Rect> {
        let surface = focused?;
        let (caret, characters) = self.carets.get(surface)?;
        let rect = characters.last().unwrap_or(caret);
        let corner =
            |x: f64, y: f64| targets.to_screen(scene, surface, Vec2::new(x as f32, y as f32));
        let a = corner(rect.x, rect.y)?;
        let b = corner(rect.x + rect.width, rect.y + rect.height.max(1.0))?;
        Some(Rect::from_corners(a, b))
    }
}
