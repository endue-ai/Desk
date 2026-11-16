//! The router's half of what crosses the window's edge (#309, `dnd/os.rs`): a drag of paths whose
//! pointer leaves the window is handed to the OS, the OS's answer ends it, and text and links an OS
//! drag carries enter and land as its files do.

use std::time::Instant;

use desk_surface::generated::SurfaceDropAnswer;
use glam::Vec2;

use super::router::{InputRouter, Out, dnd_outs};
use crate::scene::Scene;

impl InputRouter {
    /// The drag under way is at `at`: past the window's edge a surface's drag of paths goes to the
    /// OS. The OS owns the pointer until it ends the drag.
    pub(super) fn leave_window(&mut self, scene: &Scene, at: Vec2) -> Vec<Out> {
        let out = dnd_outs(self.broker.leave_window(at, scene.viewport()));
        if out.iter().any(|o| matches!(o, Out::HandOff { .. })) {
            // The OS's drag takes the release; the press it stood on is over for the desk.
            self.pointer.held.clear();
        }
        out
    }

    /// The OS drag a hand-off started ended with `effect` (or was cancelled: `None`).
    pub(super) fn hand_off_ended(&mut self, effect: Option<SurfaceDropAnswer>) -> Vec<Out> {
        dnd_outs(self.broker.os_ended(effect))
    }

    /// Text and links an OS drag carries are over the window (`drop`: it let go there).
    pub(super) fn os_data(
        &mut self,
        scene: &Scene,
        text: Option<&str>,
        uris: &[String],
        drop: bool,
        now: Instant,
    ) -> Vec<Out> {
        let at = self.pointer.at;
        let mut out = Vec::new();
        if !drop || !self.broker.from_os() {
            let entered =
                self.broker
                    .enter_os_data(scene, &self.targets, text, uris, at, self.mods);
            out.extend(dnd_outs(entered));
        }
        if drop && self.broker.from_os() {
            let released = self
                .broker
                .release(scene, &self.targets, at, self.mods, now);
            out.extend(dnd_outs(released));
        }
        out
    }
}
