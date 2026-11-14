//! A desktop coming in front slides in from the side it lies on (ADR 0222). A switch used to swap
//! every window in one frame. Now the windows of the desktop in front are drawn to the side of
//! where they rest, from a whole app's width to none over `--motion-base` with the desk's easing
//! (`at`): from the right for a desktop further along the desktops' order, from the left for one
//! before. The desktop that left goes the same way, a whole app ahead (`out`); the window manager
//! no longer places its windows, so the compositor draws that sheet from the windows it drew last
//! (`apps/desk/shell`, `compositor_window/draw_slide.rs`). Reduced motion slides nothing, and
//! neither does the first desk drawn or a switch from a desktop that is gone.

use super::motion::{Glide, Motion};
use super::wm::Wm;
use crate::desktops::position_of;
use crate::types::Rect;

/// One switch's slide: the desktop in front on its way from `from` pixels to the side.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Slide {
    /// Where the desktop in front starts: a whole app to the right (positive), or to the left.
    from: f64,
    glide: Glide,
}

impl Slide {
    /// A slide from `from` pixels to the side, starting `now`; none without motion.
    pub fn new(from: f64, now: f64, motion: Motion) -> Option<Slide> {
        let at = |x: f64| Rect::new(x, 0.0, 0.0, 0.0);
        (motion.base > 0.0 && from != 0.0).then(|| Slide {
            from,
            glide: Glide::new(at(from), at(0.0), now, motion.base, motion.easing),
        })
    }

    /// How far to the side of its place the desktop in front is at `now`.
    pub fn at(&self, now: f64) -> f64 {
        self.glide.at(now).x
    }

    /// How far to the side the desktop that left is at `now`: a whole app further the same way.
    pub fn out(&self, now: f64) -> f64 {
        self.at(now) - self.from
    }

    pub fn done(&self, now: f64) -> bool {
        self.glide.done(now)
    }
}

impl Wm {
    /// The desktop in front changed from `before` to `here` at `now`: it slides in from the side
    /// it lies on.
    pub(super) fn slide_from(&mut self, before: &str, here: &str, now: f64) {
        let list = self.drawn.desktops();
        let (was, is) = (position_of(list, before), position_of(list, here));
        self.slide = if was == 0 || is == 0 || was == is {
            None
        } else {
            let side = if is > was { 1.0 } else { -1.0 };
            Slide::new(side * self.screen.w, now, self.motion)
        };
    }

    /// While a switch slides: how far to the side the desktop in front and the one that left are
    /// drawn at `now`.
    pub fn sliding(&self, now: f64) -> Option<(f64, f64)> {
        let slide = self.slide.filter(|s| !s.done(now))?;
        Some((slide.at(now), slide.out(now)))
    }
}
