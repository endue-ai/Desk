//! The window manager the compositor drives (#80, ADR 0153): one [`Wm`] holds the desk (#83: the
//! window manager's state, which the runtime no longer keeps), the desks it published that the page
//! has not laid out yet, the gesture under way, and what glides. It hears the compositor's pointer
//! and keys (`pointer.rs`), the desk's commands (`ops.rs`) and the runtime's edits (`edit.rs`),
//! changes its desk and publishes it whole on each change (`publish.rs`), and says each frame where
//! every window is drawn (a held window under the pointer, a window gliding into its part) and
//! where the snap preview is.

use std::collections::BTreeMap;

use crate::clearance::TopChrome;
use crate::coordinates::screen_rect;
use crate::desk::Desk;
use crate::edits::Kept;
use crate::fill::snap_rect;
use crate::types::{Fill, Rect, Size};
use crate::view::View;

use super::gesture::{Gesture, Live};
use super::motion::{Glide, Motion, Preview};
use super::pointer::{PressLog, Waiting};
use super::publish::{Answered, Change, Published};

/// How many published desks wait for the page to take them, at most.
const UNTAKEN: usize = 64;

/// What the compositor's shell does after the window manager heard something.
#[derive(Clone, Debug, PartialEq)]
pub enum Out {
    /// The runtime takes this as the desk (`desk://compositor-wm`).
    Publish(Box<Published>),
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
    /// The desk the page laid out last: the one published under the revision it took.
    page: Desk,
    pub(super) drawn: Desk,
    /// The arrangements' history and the desktops' undo, beside the desk.
    pub(super) kept: Kept,
    pub(super) screen: Size,
    pub(super) motion: Motion,
    rev: u64,
    /// The desks published that the page has not taken yet, by revision.
    published: Vec<(u64, Desk)>,
    /// The screen of the last desk published: a new size publishes again.
    published_screen: Size,
    pub(super) press: Option<PressLog>,
    pub(super) gesture: Option<Gesture>,
    pub(super) glides: BTreeMap<String, Glide>,
    /// A window a press stopped mid-glide, drawn where it stopped until the press ends (#124).
    pub(super) stopped: Option<(String, Rect)>,
    /// The top chips' edges, which a fill's title keeps clear of (`mid_glide.rs`).
    pub(super) top: TopChrome,
    /// The system layer's parts on screen, drawn above every window: a press on one is the
    /// page's (`mid_glide.rs`).
    pub(super) parts: Vec<Rect>,
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
        let screen = Size {
            w: 1440.0,
            h: 900.0,
        };
        Wm {
            page: Desk::default(),
            drawn: Desk::default(),
            kept: Kept::default(),
            screen,
            motion: Motion::default(),
            rev: 0,
            published: Vec::new(),
            published_screen: screen,
            press: None,
            gesture: None,
            glides: BTreeMap::new(),
            stopped: None,
            top: TopChrome::default(),
            parts: Vec::new(),
            preview: Preview::default(),
            waiting: Vec::new(),
            clock: 0.0,
            last: BTreeMap::new(),
            last_desktop: String::new(),
        }
    }

    /// The desk: the window manager's state, as it draws it.
    pub fn desk(&self) -> &Desk {
        &self.drawn
    }

    /// The desk as the page last took it: where the page lays the windows out.
    pub fn page(&self) -> &Desk {
        &self.page
    }

    /// What the runtime reads of the desk now.
    pub fn view(&self) -> View {
        View::of(&self.drawn, &self.kept.arranger, self.screen)
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

    /// The runtime started again (its page loaded again): an empty desk, nothing kept beside it,
    /// no gesture. Revisions go on counting.
    pub fn reset(&mut self) {
        let (rev, screen, motion) = (self.rev, self.screen, self.motion);
        *self = Wm::new();
        self.rev = rev;
        self.motion = motion;
        self.start(Desk::default(), screen);
    }

    /// Start from `desk` (a test's, a restored one) without publishing it.
    pub fn start(&mut self, desk: Desk, screen: Size) {
        self.page = desk.clone();
        self.drawn = desk;
        self.screen = screen;
        self.published_screen = screen;
    }

    /// The page laid out every desk published up to revision `applied`, on a `screen`-sized app.
    /// A new size publishes the desk again, since where each window is on screen changed.
    pub fn took(&mut self, applied: u64, screen: Size) -> Vec<Out> {
        if let Some(at) = self.published.iter().rposition(|(rev, _)| *rev <= applied) {
            self.page = self.published[at].1.clone();
            self.published.drain(..=at);
        }
        self.screen = screen;
        let mut out = Vec::new();
        if screen != self.published_screen {
            out.push(self.publish(None));
        }
        out.extend(self.retry());
        out
    }

    /// Publish the desk whole under the next revision, with `answered`.
    pub(super) fn publish(&mut self, answered: Option<Answered>) -> Out {
        self.rev += 1;
        self.published.push((self.rev, self.drawn.clone()));
        if self.published.len() > UNTAKEN {
            // A page that never says what it took lays out the oldest kept.
            self.page = self.published.remove(0).1;
        }
        self.published_screen = self.screen;
        Out::Publish(Box::new(Published {
            rev: self.rev,
            desk: self.drawn.clone(),
            view: self.view(),
            answered,
        }))
    }

    /// Make `change` on the desk and publish it.
    pub(super) fn change(&mut self, change: Change) -> Out {
        change.apply(&mut self.drawn);
        self.publish(None)
    }

    /// Window `id` of the desktop in front, on screen, as its placement says.
    pub(super) fn target(&self, id: &str) -> Option<Rect> {
        let p = self.drawn.window(id)?;
        let pan = self.drawn.pan_of(&self.drawn.here());
        Some(screen_rect(&p, pan, self.screen.w, self.screen.h))
    }

    /// Where window `id` is drawn now: under the pointer, where a press stopped its glide, gliding,
    /// or at its placement.
    pub fn drawn_rect(&self, id: &str, now: f64) -> Option<Rect> {
        if let Some(Live::Window { id: held, rect, .. }) =
            self.gesture.as_ref().and_then(Gesture::live)
            && held == id
        {
            let g = self.gesture.as_ref()?;
            return Some(g.sized(*rect, now, self.motion));
        }
        if let Some((stopped, rect)) = &self.stopped
            && stopped == id
        {
            return Some(*rect);
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
