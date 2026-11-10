//! The spread running (ADR 0116; the controller of `packages/runtime/src/arrange/spread.ts`): the
//! model with its motions between poses on the caller's clock (ADR 0013), so a test that freezes the
//! clock freezes the spread. It opens from every window where it is, moves when a key, the filter or
//! the pointer changes the model, and closes back to where the windows are, on the window chosen or
//! on none. Times are milliseconds the caller passes in; what is drawn at a time is `frame`'s. The
//! caller brings a chosen window into sight before it closes on it (`choose`), so the windows go
//! back to where they are then, and gives it the focus once `frame` says the spread has closed.

use std::collections::BTreeMap;

use crate::interact::{Easing, duration_ms};
use crate::types::KeyPress;

use super::model::{SpreadAction, SpreadModel};
use super::pose::{IDENTITY, Pose, mix};
use super::windows::SpreadWindow;

/// How long each motion takes, in milliseconds: opening (`--motion-slow`), a move of the selection
/// or the filter (`--motion-fast`) and closing (`--motion-base`). Reduced motion is all zero.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Durations {
    pub open: f64,
    pub moved: f64,
    pub close: f64,
}

impl Default for Durations {
    /// The endue design system's: 400, 150 and 220 ms.
    fn default() -> Self {
        Durations {
            open: 400.0,
            moved: 150.0,
            close: 220.0,
        }
    }
}

impl Durations {
    /// From the theme's tokens (`motionSlow`, `motionFast`, `motionBase`); a token missing or
    /// unread keeps the default, and reduced motion moves nothing.
    pub fn from_tokens(token: impl Fn(&str) -> Option<String>, reduced: bool) -> Durations {
        if reduced {
            return Durations::none();
        }
        let base = Durations::default();
        let ms = |name: &str, or: f64| token(name).and_then(|v| duration_ms(&v)).unwrap_or(or);
        Durations {
            open: ms("motionSlow", base.open),
            moved: ms("motionFast", base.moved),
            close: ms("motionBase", base.close),
        }
    }

    pub fn none() -> Durations {
        Durations {
            open: 0.0,
            moved: 0.0,
            close: 0.0,
        }
    }
}

/// How the spread ends.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Ending {
    /// On this window: it takes the focus now.
    Chosen(String),
    /// With nothing chosen: the focus stays where it was.
    Cancelled,
}

/// One motion: every window from where it was drawn to where it goes.
#[derive(Clone, Debug, PartialEq)]
struct Motion {
    from: BTreeMap<String, Pose>,
    to: BTreeMap<String, Pose>,
    started: f64,
    duration: f64,
}

impl Motion {
    fn progress(&self, now: f64) -> f64 {
        if self.duration <= 0.0 {
            return 1.0;
        }
        let t = ((now - self.started) / self.duration).clamp(0.0, 1.0);
        Easing::DESK.at(t)
    }

    fn at(&self, now: f64) -> BTreeMap<String, Pose> {
        let k = self.progress(now);
        let from = |id: &str| self.from.get(id).copied().unwrap_or(IDENTITY);
        (self.to.iter())
            .map(|(id, to)| {
                (
                    id.clone(),
                    if k >= 1.0 { *to } else { mix(from(id), *to, k) },
                )
            })
            .collect()
    }

    fn done(&self, now: f64) -> bool {
        self.duration <= 0.0 || now - self.started >= self.duration
    }
}

/// What the spread draws at one time.
#[derive(Clone, Debug, PartialEq)]
pub struct SpreadFrame {
    /// Every window's pose, by id.
    pub poses: BTreeMap<String, Pose>,
    /// A motion is under way: draw again.
    pub moving: bool,
    /// The spread has closed, this way: the caller lets it go.
    pub closed: Option<Ending>,
}

/// The spread while it is open.
#[derive(Clone, Debug, PartialEq)]
pub struct Spread {
    model: SpreadModel,
    motion: Motion,
    closing: Option<Ending>,
    durations: Durations,
}

impl Spread {
    /// Fan `windows` out on a `vw`×`vh` app from where they are at `now`, flat when motion is
    /// reduced, on `focused` when it is among them; `None` when there is no window.
    pub fn open(
        windows: Vec<SpreadWindow>,
        (vw, vh): (f64, f64),
        flat: bool,
        focused: Option<&str>,
        durations: Durations,
        now: f64,
    ) -> Option<Spread> {
        if windows.is_empty() {
            return None;
        }
        let mut model = SpreadModel::new(windows, vw, vh, flat, focused);
        model.keep_in_view();
        let to = model.poses();
        let from = to.keys().map(|id| (id.clone(), IDENTITY)).collect();
        let motion = Motion {
            from,
            to,
            started: now,
            duration: durations.open,
        };
        Some(Spread {
            model,
            motion,
            closing: None,
            durations,
        })
    }

    pub fn model(&self) -> &SpreadModel {
        &self.model
    }

    /// How it ends, once it closes.
    pub fn closing(&self) -> Option<&Ending> {
        self.closing.as_ref()
    }

    /// A key at `now`: arrows, Tab, Home and End move the selection, Escape closes on nothing.
    /// Enter answers `Choose` and changes nothing: the caller brings the window into sight and
    /// calls `choose`. Anything else, and every key once it closes, is `None`.
    pub fn key(&mut self, key: &KeyPress, now: f64) -> SpreadAction {
        if self.closing.is_some() {
            return SpreadAction::None;
        }
        let action = self.model.key(key);
        match &action {
            SpreadAction::Cancel => self.cancel(now),
            SpreadAction::Moved => self.changed(self.durations.moved, now),
            SpreadAction::Choose { .. } | SpreadAction::None => {}
        }
        action
    }

    /// Typing filters by title.
    pub fn filter(&mut self, text: &str, now: f64) {
        if self.closing.is_some() {
            return;
        }
        self.model.set_filter(text);
        self.model.keep_in_view();
        self.changed(self.durations.moved, now);
    }

    /// The pointer over a card selects it; whether that changed anything.
    pub fn hover(&mut self, id: &str, now: f64) -> bool {
        if self.closing.is_some() || !self.model.select(id) {
            return false;
        }
        self.changed(self.durations.moved, now);
        true
    }

    /// A drag or the wheel on the scrim pans, at once.
    pub fn pan(&mut self, dx: f64, dy: f64, now: f64) {
        if self.closing.is_none() {
            self.model.pan(dx, dy);
            self.changed(0.0, now);
        }
    }

    /// A pinch or Control + wheel zooms about `(x, y)`, at once.
    pub fn zoom(&mut self, factor: f64, x: f64, y: f64, now: f64) {
        if self.closing.is_none() {
            self.model.zoom_at(factor, x, y);
            self.changed(0.0, now);
        }
    }

    /// The desk changed under the spread (a window opened, closed or moved): follow it. False when
    /// no window is left, and the spread closes on none.
    pub fn sync(&mut self, windows: Vec<SpreadWindow>, now: f64) -> bool {
        if self.closing.is_some() {
            return true;
        }
        if windows.is_empty() {
            self.cancel(now);
            return false;
        }
        if windows == self.model.windows() {
            return true;
        }
        self.model.update(windows);
        self.changed(self.durations.moved, now);
        true
    }

    /// Close on window `id`, which the caller has brought into sight: `windows` are where they are
    /// now, and they go back there.
    pub fn choose(&mut self, id: &str, windows: Vec<SpreadWindow>, now: f64) {
        if self.closing.is_some() {
            return;
        }
        if !windows.is_empty() {
            self.model.update(windows);
        }
        self.model.select(id);
        self.close(Ending::Chosen(id.to_owned()), now);
    }

    /// Close with nothing chosen.
    pub fn cancel(&mut self, now: f64) {
        if self.closing.is_none() {
            self.close(Ending::Cancelled, now);
        }
    }

    /// What is drawn at `now`; once the closing motion ends, how the spread ended.
    pub fn frame(&self, now: f64) -> SpreadFrame {
        let mut poses = self.motion.at(now);
        for w in self.model.windows() {
            // A window that came after the motion started is drawn where the model puts it.
            poses
                .entry(w.id.clone())
                .or_insert_with(|| self.model.pose_of(w));
        }
        let done = self.motion.done(now);
        SpreadFrame {
            poses,
            moving: !done,
            closed: if done { self.closing.clone() } else { None },
        }
    }

    fn close(&mut self, ending: Ending, now: f64) {
        let home = (self.model.windows().iter())
            .map(|w| (w.id.clone(), IDENTITY))
            .collect();
        self.go(home, self.durations.close, now);
        self.closing = Some(ending);
    }

    /// The model changed: every window from where it is drawn now to its new pose over `ms`.
    fn changed(&mut self, ms: f64, now: f64) {
        let to = self.model.poses();
        self.go(to, ms, now);
    }

    fn go(&mut self, to: BTreeMap<String, Pose>, duration: f64, now: f64) {
        let from = self.frame(now).poses;
        self.motion = Motion {
            from,
            to,
            started: now,
            duration,
        };
    }
}
