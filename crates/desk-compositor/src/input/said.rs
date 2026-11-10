//! What surfaces tell the router (`input.md`, `ime.md`): the cursor each wants, whether it takes
//! text and where its caret is, the types its drop targets accept, its drags and their answers; and
//! the surfaces that leave the desk, which take no input any more.

use std::time::Instant;

use desk_surface::generated::SurfaceMessage;

use super::router::{InputRouter, Out, dnd_outs};
use crate::scene::Scene;

impl InputRouter {
    /// What a surface said that input cares about: its cursor, whether it takes text and where its
    /// caret is, the types it accepts and its drags.
    pub fn surface_message(
        &mut self,
        scene: &Scene,
        message: &SurfaceMessage,
        now: Instant,
    ) -> Vec<Out> {
        let before = (self.focus.clone(), self.broker.overlay());
        let mut out = Vec::new();
        match message {
            SurfaceMessage::SurfaceCursorChange(c) => {
                self.cursors.set(&c.surface, c.cursor.clone())
            }
            SurfaceMessage::SurfaceImeEnabled(e) => self.ime.set_enabled(&e.surface, e.enabled),
            SurfaceMessage::SurfaceImeCaret(c) => {
                let characters = c.characters.clone().unwrap_or_default();
                self.ime.caret(&c.surface, c.caret.clone(), characters);
            }
            SurfaceMessage::SurfaceDragAccept(a) => self.broker.accept(&a.surface, &a.types),
            SurfaceMessage::SurfaceDragStart(start) => {
                let held = self
                    .pointer
                    .capture
                    .clone()
                    .filter(|_| !self.pointer.held.is_empty());
                let at = self.pointer.at;
                let dnd =
                    self.broker
                        .start(scene, &self.targets, start, held.as_deref(), at, self.mods);
                out.extend(dnd_outs(dnd));
            }
            SurfaceMessage::SurfaceDragStatus(s) => {
                out.extend(dnd_outs(self.broker.status(
                    &self.targets,
                    &s.surface,
                    s.effect,
                )));
            }
            SurfaceMessage::SurfaceDragDone(d) => {
                out.extend(dnd_outs(self.broker.done(&d.surface, d.effect)));
            }
            _ => {}
        }
        out.extend(dnd_outs(self.broker.tick(&self.targets, now)));
        out.extend(self.settle(scene, before));
        out
    }

    /// Surface `surface` left the desk (destroyed, asleep, died): it takes no input any more.
    pub fn forget(&mut self, surface: &str) -> Vec<Out> {
        let mut out = dnd_outs(self.broker.gone(&self.targets, surface));
        self.pointer.forget(surface);
        self.ime.forget(surface);
        self.cursors.forget(surface);
        self.keys_down.retain(|_, s| s.as_deref() != Some(surface));
        if self.focus.as_deref() == Some(surface) {
            self.focus = None;
            out.push(Out::Redraw);
        }
        out
    }

    /// The scene changed under a still pointer: whoever is under it now hears it.
    pub fn retarget(&mut self, scene: &Scene) -> Vec<Out> {
        let before = (self.focus.clone(), self.broker.overlay());
        let mut out = Vec::new();
        if self.pointer.capture.is_none()
            && !self.broker.active()
            && !self.pointer.hearing.is_empty()
        {
            let at = self.pointer.at;
            let moved = self
                .pointer
                .moved(scene, &self.targets, at, self.mods, &self.settings);
            out.extend(moved.into_iter().map(Out::Send));
        }
        out.extend(self.settle(scene, before));
        out
    }
}
