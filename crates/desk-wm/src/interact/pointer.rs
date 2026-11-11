//! The compositor's pointer and keys for the window manager (ADR 0153). The page's DOM still
//! finds what a press lands on (a window's title bar, one of its grips, the canvas with Shift, or a
//! bar of its system layer floating above them), as the runtime's `draggable` handles accepted it;
//! it says so with a grab ([`Wm::grab`]). Everything else runs here, on the compositor's input: the
//! press and what followed it are kept until the grab arrives, then played into the gesture, so a
//! drag the person finished before the page answered still lands. Escape cancels, as does the app
//! losing the focus.

use crate::types::Point;

use super::gesture::{Done, Gesture, Kind, Live};
use super::ops::Op;
use super::publish::{Change, Geometry};
use super::wm::{Out, Wm};

/// How far, in pixels, a grab's press may be from the press the compositor saw.
const SAME_PRESS: f64 = 2.0;
/// How much of a press's path is kept for a grab still to come.
const KEPT: usize = 4096;

/// What followed a press, kept for its grab.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum Logged {
    Moved(Point),
    Released(Point),
    Cancelled,
}

/// How many of the runtime's desks a grab or a command waits for its window before it is dropped.
const PATIENCE: u32 = 30;

/// A grab or a window command for a window the desk does not have yet.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum Waiting {
    Grab { kind: Kind, at: Point, seen: u32 },
    Op { op: Op, window: String, seen: u32 },
}

/// The last press of the primary button and what followed it.
#[derive(Clone, Debug, PartialEq)]
pub struct PressLog {
    pub(super) at: Point,
    /// Where the page heard it: the same point, but for a window drawn ahead of the page (a glide),
    /// whose parts the page hears where it lays them out.
    pub(super) page: Point,
    pub(super) events: Vec<Logged>,
    /// A grab took it already.
    pub(super) taken: bool,
}

impl Wm {
    /// The primary button went down at `at`.
    pub fn pressed(&mut self, at: Point) -> Vec<Out> {
        self.pressed_at(at, at)
    }

    /// The primary button went down at `at`, which the page heard at `page`. On a window gliding
    /// as last drawn, the window manager finds what the press starts itself, and no grab counts
    /// for it (`mid_glide.rs`).
    pub fn pressed_at(&mut self, at: Point, page: Point) -> Vec<Out> {
        let mut out = self.cancel_gesture();
        // A double-click after this press is a double-click again.
        self.dragged = None;
        // A grab still waiting is for an earlier press.
        self.waiting.retain(|w| !matches!(w, Waiting::Grab { .. }));
        let taken = self.press_mid_glide(at);
        if taken {
            out.push(Out::Redraw);
        }
        self.press = Some(PressLog {
            at,
            page,
            events: Vec::new(),
            taken,
        });
        out
    }

    fn log(&mut self, event: Logged) {
        if let Some(log) = self.press.as_mut().filter(|l| !l.taken)
            && log.events.len() < KEPT
        {
            log.events.push(event);
        }
    }

    /// The pointer moved to `at`.
    pub fn moved(&mut self, at: Point, now: f64) -> Vec<Out> {
        self.clock = now;
        self.log(Logged::Moved(at));
        self.step(at, now)
    }

    /// The primary button went up at `at`.
    pub fn released(&mut self, at: Point, now: f64) -> Vec<Out> {
        self.log(Logged::Released(at));
        self.release(at, now)
    }

    /// The page found that the press at `at` starts `kind`: the gesture runs from that press, and
    /// what followed it so far plays into it.
    pub fn grab(&mut self, kind: Kind, at: Point, now: f64) -> Vec<Out> {
        if let Some(id) = Self::window_of(&kind)
            && self.drawn.window(id).is_none()
        {
            // The desk that has the window is on its way.
            self.waiting.push(Waiting::Grab { kind, at, seen: 0 });
            return Vec::new();
        }
        let Some(log) = self.press.as_mut() else {
            return Vec::new();
        };
        let near = |p: Point| (p.x - at.x).abs() <= SAME_PRESS && (p.y - at.y).abs() <= SAME_PRESS;
        let near = near(log.at) || near(log.page);
        if log.taken || !near {
            return Vec::new();
        }
        log.taken = true;
        let (from, events) = (log.at, std::mem::take(&mut log.events));
        let mut out = self.cancel_gesture();
        self.gesture = Some(Gesture::new(kind, from));
        for event in events {
            match event {
                Logged::Moved(to) => out.extend(self.step(to, now)),
                Logged::Released(to) => out.extend(self.release(to, now)),
                Logged::Cancelled => out.extend(self.cancel_gesture()),
            }
        }
        out
    }

    fn window_of(kind: &Kind) -> Option<&str> {
        match kind {
            Kind::Move { window } | Kind::Resize { window, .. } => Some(window),
            Kind::Pan => None,
        }
    }

    /// Wait for window `window` to run `op` on it.
    pub(super) fn wait_for(&mut self, op: Op, window: &str) {
        let (op, window) = (op, window.to_owned());
        self.waiting.push(Waiting::Op {
            op,
            window,
            seen: 0,
        });
    }

    /// Run what waited for a window the desk now has; drop what waited too long.
    pub(super) fn retry(&mut self) -> Vec<Out> {
        let mut out = Vec::new();
        for waiting in std::mem::take(&mut self.waiting) {
            let id = match &waiting {
                Waiting::Grab { kind, .. } => Self::window_of(kind).unwrap_or_default().to_owned(),
                Waiting::Op { window, .. } => window.clone(),
            };
            if self.drawn.window(&id).is_some() {
                out.extend(match waiting {
                    Waiting::Grab { kind, at, .. } => self.grab(kind, at, self.clock),
                    Waiting::Op { op, window, .. } => self.run(&op, Some(&window)),
                });
                continue;
            }
            let mut later = waiting;
            let (Waiting::Grab { seen, .. } | Waiting::Op { seen, .. }) = &mut later;
            *seen += 1;
            if *seen < PATIENCE {
                self.waiting.push(later);
            }
        }
        out
    }

    /// Whether a press the window manager runs holds the pointer: the compositor's surfaces hear
    /// none of it.
    pub fn holds(&self) -> bool {
        self.gesture.as_ref().is_some_and(|g| !g.over())
    }

    /// Escape: whether it cancelled a drag (the key then goes nowhere else).
    pub fn escape(&mut self) -> (bool, Vec<Out>) {
        self.log(Logged::Cancelled);
        let dragging = self.gesture.as_ref().is_some_and(Gesture::dragging);
        let out = self.cancel_gesture();
        (dragging, out)
    }

    /// The app lost the focus, or the pointer was taken away: a drag is cancelled.
    pub fn cancel(&mut self) -> Vec<Out> {
        self.log(Logged::Cancelled);
        self.cancel_gesture()
    }

    pub(super) fn cancel_gesture(&mut self) -> Vec<Out> {
        let Some(mut gesture) = self.gesture.take() else {
            return Vec::new();
        };
        self.preview.hide();
        // A window the press stopped mid-glide glides on from there.
        self.resume_glide(self.clock);
        match gesture.cancel() {
            Some(Done::Back { id }) => {
                self.dragged = Some((id, self.clock));
                vec![Out::Held(None), Out::Redraw]
            }
            Some(Done::Pan { desktop, pan }) => vec![self.change(Change::Pan { desktop, pan })],
            _ => Vec::new(),
        }
    }

    fn step(&mut self, at: Point, now: f64) -> Vec<Out> {
        let Some(mut gesture) = self.gesture.take().filter(|g| !g.over()) else {
            return Vec::new();
        };
        let drawn = gesture.window_id().and_then(|id| self.drawn_rect(id, now));
        let live = gesture.moved(&self.drawn, drawn, at, self.screen, now);
        let mut out = Vec::new();
        match live {
            Some(Live::Window { id, rect, aim }) => {
                let part = aim.map(|fill| self.part(fill));
                let shown = gesture.sized(rect, now, self.motion);
                self.preview.show(part, shown, now, self.motion);
                out.push(Out::Held(Some((id, rect))));
                out.push(Out::Redraw);
            }
            Some(Live::Pan { desktop, pan }) if self.drawn.pan_of(&desktop) != pan => {
                out.push(self.change(Change::Pan { desktop, pan }));
            }
            _ => {}
        }
        if gesture.over() {
            // It could not start (the window went, or is pinned).
            self.resume_glide(now);
        } else {
            self.gesture = Some(gesture);
        }
        out
    }

    fn release(&mut self, at: Point, now: f64) -> Vec<Out> {
        let Some(mut gesture) = self.gesture.take() else {
            return Vec::new();
        };
        self.preview.hide();
        let done = gesture.released(&self.drawn, at, self.screen);
        if let Some(id) = done.as_ref().and(gesture.window_id()) {
            // The page hears the release as the end of a click: the second of a double-click when
            // the press came soon after another (`ops.rs` drops the maximize it asks for).
            self.dragged = Some((id.to_owned(), now));
        }
        // A window the press stopped mid-glide and never dragged glides on from there; a drop
        // places it.
        if done.is_none() {
            self.resume_glide(now);
        }
        self.stopped = None;
        let motion = self.motion;
        let mut out = Vec::new();
        match done {
            Some(Done::Place { id, rect, floating }) => {
                // A filled window's size may still be on its way back: it goes on from there.
                let from = gesture.sized(rect, now, motion);
                // A move glides on into reach of the pointer; a resize leaves the window where
                // its edges are, but for a top edge taken past where its title bar is in reach.
                let rect = match &gesture.kind {
                    Kind::Move { .. } => self.in_reach(rect),
                    Kind::Resize { grip, .. } if grip.north() => self.top_in_reach(&id, rect),
                    _ => rect,
                };
                out.push(Out::Held(None));
                out.extend(self.place(&id, rect, floating));
                self.glide(&id, from, now);
            }
            Some(Done::Snap { id, fill, from }) => {
                let from = gesture.sized(from, now, motion);
                out.push(Out::Held(None));
                self.drawn.snap_to(&id, fill);
                out.extend(self.publish_window(&id));
                // From where the drop left it into its part.
                self.glide(&id, from, now);
            }
            Some(Done::Pan { desktop, pan }) => {
                if self.drawn.pan_of(&desktop) != pan {
                    out.push(self.change(Change::Pan { desktop, pan }));
                }
            }
            Some(Done::Back { .. }) => out.push(Out::Held(None)),
            None => {}
        }
        out.push(Out::Redraw);
        out
    }

    /// Window `id` dropped at `rect` on screen, stored in the mode `floating` says, out of any
    /// fill.
    pub(super) fn place(&mut self, id: &str, rect: crate::types::Rect, floating: bool) -> Vec<Out> {
        let pan = self.drawn.pan_of(&self.drawn.here());
        let (vw, vh) = (self.screen.w, self.screen.h);
        let stored = crate::coordinates::stored_rect(rect, floating, pan, vw, vh);
        let body = crate::pane_min::body_size(rect.w, rect.h);
        self.drawn.update(id, |p| {
            p.set_rect(stored);
            p.floating = floating.then_some(true);
            p.restore = None;
            p.fill = None;
            // Each pane keeps its room at the new size, where the window has it.
            if let Some(tree) = &p.panes {
                p.panes = Some(crate::pane_min::fit_panes(tree, body));
            }
        });
        self.publish_window(id)
    }

    /// Publish window `id`'s geometry as the desk now has it.
    pub(super) fn publish_window(&mut self, id: &str) -> Vec<Out> {
        let desktop = self.drawn.here();
        let Some(p) = (self.drawn.layout_of(desktop.as_str()).surfaces)
            .into_iter()
            .find(|p| p.id == id)
        else {
            return Vec::new();
        };
        let geometry = Geometry::of(&p);
        vec![self.change(Change::Window { desktop, geometry })]
    }
}
