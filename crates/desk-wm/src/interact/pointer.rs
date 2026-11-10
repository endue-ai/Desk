//! The compositor's pointer and keys for the window manager (ADR 0152). The page's DOM still
//! finds what a press lands on (a window's title bar, one of its grips, the canvas with Shift, or a
//! bar of its system layer floating above them), as the runtime's `draggable` handles accepted it;
//! it says so with a grab ([`Wm::grab`]). Everything else runs here, on the compositor's input: the
//! press and what followed it are kept until the grab arrives, then played into the gesture, so a
//! drag the person finished before the page answered still lands. Escape cancels, as does the app
//! losing the focus.

use crate::types::Point;

use super::gesture::{Done, Gesture, Kind, Live};
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

/// The last press of the primary button and what followed it.
#[derive(Clone, Debug, PartialEq)]
pub struct PressLog {
    pub(super) at: Point,
    pub(super) events: Vec<Logged>,
    /// A grab took it already.
    pub(super) taken: bool,
}

impl Wm {
    /// The primary button went down at `at`.
    pub fn pressed(&mut self, at: Point) -> Vec<Out> {
        let out = self.cancel_gesture();
        self.press = Some(PressLog {
            at,
            events: Vec::new(),
            taken: false,
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
        let Some(log) = self.press.as_mut() else {
            return Vec::new();
        };
        let near = (log.at.x - at.x).abs() <= SAME_PRESS && (log.at.y - at.y).abs() <= SAME_PRESS;
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
        match gesture.cancel() {
            Some(Done::Back { .. }) => vec![Out::Held(None), Out::Redraw],
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
        if !gesture.over() {
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
        let motion = self.motion;
        let mut out = Vec::new();
        match done {
            Some(Done::Place { id, rect, floating }) => {
                // A filled window's size may still be on its way back: it goes on from there.
                let from = gesture.sized(rect, now, motion);
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
        self.drawn.update(id, |p| {
            p.set_rect(stored);
            p.floating = floating.then_some(true);
            p.restore = None;
            p.fill = None;
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
