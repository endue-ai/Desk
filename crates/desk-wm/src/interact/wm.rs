//! The window manager the compositor drives (#80, ADR 0153): one [`Wm`] holds the desk as the
//! runtime last published it, the changes it made since that the runtime has not taken yet, the
//! gesture under way, and what glides. It hears the compositor's pointer and keys (`pointer.rs`)
//! and the desk's commands (`ops.rs`), changes its desk and publishes each change for the runtime
//! (`publish.rs`), and says each frame where every window is drawn (a held window under the
//! pointer, a window gliding into its part) and where the snap preview is.

use std::collections::BTreeMap;

use crate::coordinates::screen_rect;
use crate::desk::Desk;
use crate::fill::snap_rect;
use crate::types::{Fill, Rect, Size};

use super::gesture::{Gesture, Live};
use super::motion::{Glide, Motion, Preview};
use super::pointer::{PressLog, Waiting};
use super::publish::{Change, Published};

/// What the compositor's shell does after the window manager heard something.
#[derive(Clone, Debug, PartialEq)]
pub enum Out {
    /// The runtime takes this as the truth (`desk://compositor-wm`).
    Publish(Published),
    /// The page lays window `id` out at `rect` while a gesture holds it (`None`: no longer), so
    /// what it draws of the window follows the pointer.
    Held(Option<(String, Rect)>),
    /// Something drawn changed.
    Redraw,
}

/// Where things are drawn at one moment.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Frame {
    /// The windows drawn somewhere else than their placement says, on screen.
    pub drawn: BTreeMap<String, Rect>,
    /// The snap preview and the window it lies under.
    pub preview: Option<(Rect, String)>,
    /// Something is still on its way: draw again.
    pub moving: bool,
}

/// The window manager on the compositor's input.
#[derive(Clone, Debug)]
pub struct Wm {
    page: Desk,
    pub(super) drawn: Desk,
    pub(super) screen: Size,
    pub(super) motion: Motion,
    rev: u64,
    pending: Vec<(u64, Change)>,
    pub(super) press: Option<PressLog>,
    pub(super) gesture: Option<Gesture>,
    pub(super) glides: BTreeMap<String, Glide>,
    pub(super) preview: Preview,
    /// Grabs and commands for a window the runtime has not published yet: the page's calls each
    /// run on a thread of their own, so one may overtake the desk it follows (`pointer.rs`).
    pub(super) waiting: Vec<Waiting>,
    /// The last time it heard, for what waited and runs later.
    pub(super) clock: f64,
    /// Each window's rect and fill as last drawn, to glide one whose fill changes.
    last: BTreeMap<String, (Rect, Option<Fill>)>,
    /// The desktop those were drawn on: another desktop's windows glide from nowhere.
    last_desktop: String,
}

impl Default for Wm {
    fn default() -> Self {
        Wm::new()
    }
}

impl Wm {
    pub fn new() -> Wm {
        Wm {
            page: Desk::default(),
            drawn: Desk::default(),
            screen: Size {
                w: 1440.0,
                h: 900.0,
            },
            motion: Motion::default(),
            rev: 0,
            pending: Vec::new(),
            press: None,
            gesture: None,
            glides: BTreeMap::new(),
            preview: Preview::default(),
            waiting: Vec::new(),
            clock: 0.0,
            last: BTreeMap::new(),
            last_desktop: String::new(),
        }
    }

    /// The desk as `desk-wm` draws it: the runtime's, with what it has not taken yet.
    pub fn desk(&self) -> &Desk {
        &self.drawn
    }

    /// The desk as the runtime last published it: where the page lays the windows out.
    pub fn page(&self) -> &Desk {
        &self.page
    }

    pub fn screen(&self) -> Size {
        self.screen
    }

    pub fn set_motion(&mut self, motion: Motion) {
        self.motion = motion;
    }

    pub fn motion(&self) -> Motion {
        self.motion
    }

    /// The last revision published.
    pub fn rev(&self) -> u64 {
        self.rev
    }

    /// The runtime published `desk` on a `screen`-sized app, having taken every change up to
    /// `applied`. A gesture whose window went is cancelled; what that calls for.
    pub fn mirror(&mut self, desk: Desk, applied: u64, screen: Size) -> Vec<Out> {
        self.page = desk;
        self.screen = screen;
        self.pending.retain(|(rev, _)| *rev > applied);
        let mut drawn = self.page.clone();
        for (_, change) in &self.pending {
            change.apply(&mut drawn);
        }
        self.drawn = drawn;
        let gone = (self.gesture.as_ref())
            .and_then(|g| g.window_id().map(str::to_owned))
            .filter(|id| self.drawn.window(id).is_none());
        let mut out = Vec::new();
        if gone.is_some() {
            out.extend(self.cancel_gesture());
        }
        out.extend(self.retry());
        out
    }

    /// Make `change` on the desk and publish it.
    pub(super) fn change(&mut self, change: Change) -> Out {
        change.apply(&mut self.drawn);
        self.rev += 1;
        let published = Published::of(self.rev, &change);
        self.pending.push((self.rev, change));
        Out::Publish(published)
    }

    /// Window `id` of the desktop in front, on screen, as its placement says.
    pub(super) fn target(&self, id: &str) -> Option<Rect> {
        let p = self.drawn.window(id)?;
        let pan = self.drawn.pan_of(&self.drawn.here());
        Some(screen_rect(&p, pan, self.screen.w, self.screen.h))
    }

    /// Where window `id` is drawn now: under the pointer, gliding, or at its placement.
    pub fn drawn_rect(&self, id: &str, now: f64) -> Option<Rect> {
        if let Some(Live::Window { id: held, rect, .. }) =
            self.gesture.as_ref().and_then(Gesture::live)
            && held == id
        {
            let g = self.gesture.as_ref()?;
            return Some(g.sized(*rect, now, self.motion));
        }
        if let Some(glide) = self.glides.get(id) {
            return Some(glide.at(now));
        }
        self.target(id)
    }

    /// Glide window `id` from `from` to where its placement puts it, starting `now`.
    pub(super) fn glide(&mut self, id: &str, from: Rect, now: f64) {
        let Some(to) = self.target(id) else {
            return;
        };
        if from == to || self.motion.base <= 0.0 {
            self.glides.remove(id);
            return;
        }
        let m = self.motion;
        self.glides
            .insert(id.to_owned(), Glide::new(from, to, now, m.base, m.easing));
    }

    /// The window a gesture holds, if it is dragged now.
    pub fn held(&self) -> Option<&str> {
        match self.gesture.as_ref()?.live()? {
            Live::Window { id, .. } => Some(id),
            Live::Pan { .. } => None,
        }
    }

    /// Where every window is drawn at `now`, and the snap preview. A window whose fill changed
    /// since the last frame (a snap, a maximize, a restore, the runtime's own) glides there, unless
    /// a gesture holds it.
    pub fn frame(&mut self, now: f64) -> Frame {
        self.clock = now;
        let here = self.drawn.here();
        if here != self.last_desktop {
            self.last.clear();
            self.last_desktop = here;
        }
        let held = self.held().map(str::to_owned);
        let windows = self.drawn.windows();
        let mut frame = Frame::default();
        let mut last = BTreeMap::new();
        for p in &windows {
            let Some(target) = self.target(&p.id) else {
                continue;
            };
            let fill = p.fill.or(p.restore.map(|_| Fill::Full));
            let gliding_there = self.glides.get(&p.id).is_some_and(|g| g.to == target);
            if held.as_deref() != Some(p.id.as_str())
                && !gliding_there
                && let Some((was, had)) = self.last.get(&p.id)
                && *had != fill
            {
                let from = *was;
                self.glide(&p.id, from, now);
            }
            if self.glides.get(&p.id).is_some_and(|g| g.to != target) {
                // Moved meanwhile (a pan, a new size): it is where it is now.
                self.glides.remove(&p.id);
            }
            let drawn = self.drawn_rect(&p.id, now).unwrap_or(target);
            if drawn != target {
                frame.drawn.insert(p.id.clone(), drawn);
            }
            last.insert(p.id.clone(), (drawn, fill));
        }
        self.glides
            .retain(|id, g| last.contains_key(id) && !g.done(now));
        self.last = last;
        frame.preview = (self.preview.at(now)).zip(held.clone());
        let sizing = (self.gesture.as_ref()).is_some_and(|g| g.sizing(now, self.motion));
        frame.moving = !self.glides.is_empty() || self.preview.moving(now) || sizing;
        frame
    }

    /// Where a fill puts a window on this app: what the preview shows.
    pub(super) fn part(&self, fill: Fill) -> Rect {
        snap_rect(fill, self.screen.w, self.screen.h)
    }
}
