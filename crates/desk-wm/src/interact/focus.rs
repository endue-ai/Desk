//! A press decides the window in use (#251, ADR 0230). The window manager hears every press before
//! it is routed: the window drawn topmost under it comes into use, with the pane under the point,
//! at once, and the desk is published so. The router reads that for the keys and the page is told;
//! neither says which window a press put in use. A part of the system layer drawn over the window
//! (a bar, an overlay) is the page's: a press on it changes nothing here, nor does a press on the
//! empty desk, which leaves the window in use as it is (ADR 0192).

use crate::host::{Cell, body_of, cells};
use crate::types::Point;

use super::mid_glide::inside;
use super::wm::{Out, Wm};

impl Wm {
    /// The window a press at `at` lands in, as drawn now: none under a part of the system layer,
    /// or on the empty desk.
    pub fn window_at(&self, at: Point) -> Option<String> {
        if self.parts.iter().any(|r| inside(*r, at)) {
            return None;
        }
        self.topmost_at(at, self.clock).map(|(p, _)| p.id)
    }

    /// The window and the pane in use.
    pub fn in_use(&self) -> (Option<&str>, Option<&str>) {
        let desk = &self.drawn;
        (desk.focused.as_deref(), desk.pane.as_deref())
    }

    /// A button went down at `at`: the window under it is in use from now, with the pane under
    /// the point (the one it had in use, or its first, for a press on its title bar, its frame or
    /// a divider). Publishes the desk when that changed something.
    pub fn press_focus(&mut self, at: Point) -> Vec<Out> {
        if self.parts.iter().any(|r| inside(*r, at)) {
            return Vec::new();
        }
        let Some((p, drawn)) = self.topmost_at(at, self.clock) else {
            return Vec::new();
        };
        let pane = (cells(&p.panes(), body_of(drawn)).into_iter()).find_map(|cell| match cell {
            Cell::Pane { id, rect, .. } if inside(rect, at) => Some(id),
            _ => None,
        });
        let in_use = self.drawn.focused.as_deref() == Some(p.id.as_str());
        let same = match &pane {
            Some(pane) => self.drawn.pane.as_deref() == Some(pane.as_str()),
            None => true,
        };
        if in_use && same {
            return Vec::new();
        }
        self.drawn.focus_pane(&p.id, pane.as_deref());
        vec![self.publish(None), Out::Redraw]
    }
}
