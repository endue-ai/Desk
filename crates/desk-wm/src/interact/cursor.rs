//! The cursor of what the window manager runs (#159 finding 13), as the page's CSS declares it for
//! the parts it hit-tests (`.surface-resize`, `.surface-title`): the grips lie over the edges of a
//! window's surfaces, so the surface under the pointer would show its own cursor there (a terminal's
//! text beam), and the desk's page draws every window's chrome without saying a cursor of its own.
//! Over a grip of the window topmost under the pointer, and while a resize holds it, the grip's
//! resize cursor; over the stretch of a title bar that drags it, a grab hand; while a move or a pan
//! is dragged, a grabbing one. Anything else, and the system layer's parts and the edge bars above
//! every window, show the cursor of the surface under the pointer.

use crate::types::Point;

use super::gesture::Kind;
use super::mid_glide::inside;
use super::resize::grip_at;
use super::wm::Wm;

/// A title bar that drags its window, under the pointer.
pub const GRAB: &str = "grab";
/// A window or the canvas dragged.
pub const GRABBING: &str = "grabbing";

impl Wm {
    /// The cursor the window manager shows with the pointer at `at`, at `now`, as CSS names it;
    /// `None` leaves the cursor to the surface under the pointer.
    pub fn cursor_at(&self, at: Point, now: f64) -> Option<&'static str> {
        if let Some(gesture) = self.gesture.as_ref().filter(|g| !g.over()) {
            match &gesture.kind {
                Kind::Resize { grip, .. } => return Some(grip.cursor()),
                Kind::Move { .. } | Kind::Pan if gesture.dragging() => return Some(GRABBING),
                _ => {}
            }
        }
        if (self.parts.iter().chain(&self.edges)).any(|r| inside(*r, at)) {
            return None;
        }
        let (p, drawn) = self.topmost_at(at, now)?;
        if let Some(grip) = grip_at(drawn, at) {
            return Some(grip.cursor());
        }
        (!p.pinned && inside(self.title_stretch(&p, drawn), at)).then_some(GRAB)
    }
}
