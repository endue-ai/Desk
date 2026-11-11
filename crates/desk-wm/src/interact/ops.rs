//! The window commands the keys, the palette and agents run (`desk.display.*`, ADR 0153): maximize
//! and restore, snap to any of the eight parts (ADR 0128), and move or resize by a step; the spread
//! (ADR 0116) is the compositor's shell's to run. Each acts on one window of the desktop in front
//! (the one in use unless named), changes the desk and publishes it, and the window glides when its
//! fill changes. Moving or resizing a filled window
//! ends its fill where it is, in the mode the window had before it filled, as resizing it by a grip
//! does; a move keeps the title bar within reach (`reach.rs`).

use serde::{Deserialize, Serialize};

use crate::coordinates::screen_rect;
use crate::fill::own_floating;
use crate::geometry::{clamp_rect, screen_area};
use crate::pane_min::window_min;
use crate::types::{Fill, Offset, Rect};

use super::publish::Change;
use super::resize::{Grip, resize_rect_min};
use super::wm::{Out, Wm};

/// One window command.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum Op {
    /// Fill the whole app, or come back from a fill.
    Maximize,
    /// Fill a half or a quarter of the app (or all of it).
    Snap { fill: Fill },
    /// Move by `dx`, `dy` pixels.
    Move { dx: f64, dy: f64 },
    /// Grow or shrink by `dw`, `dh` pixels from the right and bottom edges.
    Resize { dw: f64, dh: f64 },
    /// Fan the desktop's windows out to pick one, or close the spread (ADR 0116). It moves nothing:
    /// the compositor's shell runs it (`spread::run`) and draws it; here nothing changes.
    Spread,
}

impl Wm {
    /// Run `op` on window `window` (the one in use when `None`).
    pub fn run(&mut self, op: &Op, window: Option<&str>) -> Vec<Out> {
        if *op == Op::Spread {
            return Vec::new();
        }
        let id = window
            .map(str::to_owned)
            .or_else(|| self.drawn.focused_window());
        let Some(p) = id.as_deref().and_then(|id| self.drawn.window(id)) else {
            // A window named that the desk does not have yet: the desk is on its way.
            if let Some(window) = window {
                self.wait_for(op.clone(), window);
            }
            return Vec::new();
        };
        if self.held() == Some(p.id.as_str()) {
            return Vec::new();
        }
        let id = p.id.clone();
        let mut out = match op {
            Op::Maximize => {
                self.drawn.toggle_maximize(&id);
                self.publish_window(&id)
            }
            Op::Snap { fill } => {
                self.drawn.snap_to(&id, *fill);
                self.publish_window(&id)
            }
            Op::Move { dx, dy } => {
                let (rect, floating) = self.on_screen(&p);
                let moved = Rect::new(rect.x + dx, rect.y + dy, rect.w, rect.h);
                let (vw, vh) = (self.screen.w, self.screen.h);
                let moved = if floating {
                    clamp_rect(moved, vw, vh)
                } else {
                    moved
                };
                let moved = self.in_reach(moved);
                self.place(&id, moved, floating)
            }
            Op::Spread => Vec::new(),
            Op::Resize { dw, dh } => {
                let (rect, floating) = self.on_screen(&p);
                let bounds = floating.then(|| screen_area(self.screen.w, self.screen.h));
                let least = window_min(&p.panes());
                let resized = resize_rect_min(rect, Grip::Se, *dw, *dh, bounds, least);
                self.place(&id, resized, floating)
            }
        };
        out.push(Out::Redraw);
        out
    }

    /// Bring window `id` of the desktop in front wholly into sight, as the spread does before it
    /// gives the window the focus (ADR 0116); publishes when the canvas panned.
    pub fn reveal(&mut self, id: &str) -> Vec<Out> {
        if !self.drawn.reveal(id, self.screen.w, self.screen.h) {
            return Vec::new();
        }
        vec![self.publish(None), Out::Redraw]
    }

    /// The canvas of the desktop in front at `pan`, as the canvas map moves it (ADR 0082).
    pub fn pan_to(&mut self, pan: Offset) -> Vec<Out> {
        let desktop = self.drawn.here();
        if self.drawn.pan_of(&desktop) == pan {
            return Vec::new();
        }
        vec![self.change(Change::Pan { desktop, pan }), Out::Redraw]
    }

    /// Where `p` is on screen now and the mode a step keeps it in: its own, out of a fill.
    fn on_screen(&self, p: &crate::types::Placement) -> (Rect, bool) {
        let pan = self.drawn.pan_of(&self.drawn.here());
        (
            screen_rect(p, pan, self.screen.w, self.screen.h),
            own_floating(p),
        )
    }
}
