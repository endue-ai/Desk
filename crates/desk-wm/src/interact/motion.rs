//! What moves on its own after a gesture (ADR 0132; the `is-settling`, `is-unsnapping` and
//! `.surface-snap` transitions of `packages/runtime/src/surface/surface.css`): a window gliding
//! into its part over `--motion-base` with the desk's easing, a filled window taking its own size
//! back under the pointer over `--motion-fast`, ease-out, and the snap preview growing out of the
//! window's box and gliding from part to part. Times are milliseconds the caller passes in (the
//! frame loop's clock, ADR 0013); reduced motion zeroes the durations, so everything arrives at
//! once.

use serde::{Deserialize, Serialize};

use crate::types::Rect;

/// A CSS `cubic-bezier(x1, y1, x2, y2)` timing function.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Easing {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}

impl Easing {
    /// `--desk-easing`, the desk's ease out (`packages/ui/src/tokens.css`).
    pub const DESK: Easing = Easing::new(0.22, 1.0, 0.36, 1.0);
    /// CSS `ease-out`.
    pub const EASE_OUT: Easing = Easing::new(0.0, 0.0, 0.58, 1.0);

    pub const fn new(x1: f64, y1: f64, x2: f64, y2: f64) -> Easing {
        Easing { x1, y1, x2, y2 }
    }

    /// A token's value, `cubic-bezier(a, b, c, d)`; `None` for anything else.
    pub fn parse(css: &str) -> Option<Easing> {
        let inner = css
            .trim()
            .strip_prefix("cubic-bezier(")?
            .strip_suffix(')')?;
        let n: Vec<f64> = inner
            .split(',')
            .map(|v| v.trim().parse::<f64>())
            .collect::<Result<_, _>>()
            .ok()?;
        let [x1, y1, x2, y2] = n[..] else { return None };
        ((0.0..=1.0).contains(&x1) && (0.0..=1.0).contains(&x2)).then_some(Easing {
            x1,
            y1,
            x2,
            y2,
        })
    }

    fn curve(a: f64, b: f64, t: f64) -> f64 {
        let u = 1.0 - t;
        3.0 * u * u * t * a + 3.0 * u * t * t * b + t * t * t
    }

    /// How far along at `progress` (0 to 1) of the time: the curve's y where its x is `progress`.
    pub fn at(&self, progress: f64) -> f64 {
        let x = progress.clamp(0.0, 1.0);
        if x == 0.0 || x == 1.0 {
            return x;
        }
        // x(t) rises from 0 to 1 for control points inside [0, 1]: bisect for the t that gives x.
        let (mut lo, mut hi) = (0.0, 1.0);
        for _ in 0..48 {
            let mid = (lo + hi) / 2.0;
            if Self::curve(self.x1, self.x2, mid) < x {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        Self::curve(self.y1, self.y2, (lo + hi) / 2.0)
    }
}

/// The desk's motion as its theme sets it: `--motion-base` and `--motion-fast` in milliseconds and
/// its easing. Reduced motion is both durations at zero.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Motion {
    pub base: f64,
    pub fast: f64,
    pub easing: Easing,
}

impl Default for Motion {
    /// The endue design system's: 220 ms and 150 ms.
    fn default() -> Self {
        Motion {
            base: 220.0,
            fast: 150.0,
            easing: Easing::DESK,
        }
    }
}

impl Motion {
    /// From the theme's tokens (`motionBase`, `motionFast`, `easing`, as the token table names
    /// them); what a token does not say stays the default. Reduced motion moves nothing.
    pub fn from_tokens(token: impl Fn(&str) -> Option<String>, reduced: bool) -> Motion {
        let ms = |name: &str, or: f64| {
            let value = token(name).unwrap_or_default();
            let value = value.trim();
            let parsed = match value.strip_suffix("ms") {
                Some(n) => n.trim().parse::<f64>().ok(),
                None => value
                    .strip_suffix('s')
                    .and_then(|n| n.trim().parse::<f64>().ok())
                    .map(|s| s * 1000.0),
            };
            parsed.filter(|v| v.is_finite() && *v >= 0.0).unwrap_or(or)
        };
        let base = Motion::default();
        let easing = token("easing")
            .and_then(|v| Easing::parse(&v))
            .unwrap_or(base.easing);
        if reduced {
            return Motion {
                base: 0.0,
                fast: 0.0,
                easing,
            };
        }
        Motion {
            base: ms("motionBase", base.base),
            fast: ms("motionFast", base.fast),
            easing,
        }
    }

    /// No motion at all: what reduced motion gives.
    pub fn none() -> Motion {
        Motion {
            base: 0.0,
            fast: 0.0,
            easing: Easing::DESK,
        }
    }
}

fn mix(a: f64, b: f64, k: f64) -> f64 {
    a + (b - a) * k
}

/// `from` on the way to `to`, `k` of the way.
pub fn mix_rect(from: Rect, to: Rect, k: f64) -> Rect {
    Rect::new(
        mix(from.x, to.x, k),
        mix(from.y, to.y, k),
        mix(from.w, to.w, k),
        mix(from.h, to.h, k),
    )
}

/// A rect on its way from one place to another: a window gliding, the snap preview moving.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Glide {
    pub from: Rect,
    pub to: Rect,
    pub started: f64,
    pub duration: f64,
    pub easing: Easing,
}

impl Glide {
    pub fn new(from: Rect, to: Rect, started: f64, duration: f64, easing: Easing) -> Glide {
        Glide {
            from,
            to,
            started,
            duration,
            easing,
        }
    }

    /// How far along it is at `now`, eased: 0 at its start, 1 once its time is over.
    pub fn progress(&self, now: f64) -> f64 {
        if self.duration <= 0.0 {
            return 1.0;
        }
        self.easing
            .at(((now - self.started) / self.duration).clamp(0.0, 1.0))
    }

    /// Where it is at `now`.
    pub fn at(&self, now: f64) -> Rect {
        let k = self.progress(now);
        if k >= 1.0 {
            self.to
        } else {
            mix_rect(self.from, self.to, k)
        }
    }

    /// Whether it has arrived by `now`.
    pub fn done(&self, now: f64) -> bool {
        self.duration <= 0.0 || now - self.started >= self.duration
    }
}

/// The snap preview (`snapPreview` in `surface/interactions.ts`): where a drop would snap, under
/// the dragged window. It grows out of the window's own box when it shows, and glides from part to
/// part as the pointer moves; it goes at once when the pointer aims at nothing.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Preview {
    glide: Option<Glide>,
}

impl Preview {
    /// The pointer aims at `part` (`None`: at nothing) while the window is drawn at `window`.
    pub fn show(&mut self, part: Option<Rect>, window: Rect, now: f64, motion: Motion) {
        let Some(to) = part else {
            self.glide = None;
            return;
        };
        let from = match self.glide {
            Some(g) if g.to == to => return,
            Some(g) => g.at(now),
            None => window,
        };
        self.glide = Some(Glide::new(from, to, now, motion.base, motion.easing));
    }

    pub fn hide(&mut self) {
        self.glide = None;
    }

    /// Where it is drawn at `now`, while it shows.
    pub fn at(&self, now: f64) -> Option<Rect> {
        self.glide.map(|g| g.at(now))
    }

    /// The part it shows, once it arrives.
    pub fn target(&self) -> Option<Rect> {
        self.glide.map(|g| g.to)
    }

    /// Whether it is still on its way at `now`.
    pub fn moving(&self, now: f64) -> bool {
        self.glide.is_some_and(|g| !g.done(now))
    }
}
