//! A press on a window the compositor draws mid-glide (#124). The page lays every window out where
//! its placement puts it, so while one glides into its part the page's DOM, and its grab, cannot
//! say what a press on it means where the person sees it. The window manager finds that on the
//! rectangle being drawn, as the person sees it: one of its grips resizes the window, its title bar
//! away from its tools (and from the top chips over a fill's) moves it. The glide ends at once: the
//! window stays where it was drawn while the press holds it, and a drag takes it from there; a
//! press that never drags, or a drag cancelled, lets it glide on from there. Anything else under
//! the press is the page's and the surfaces' as before.

use crate::clearance::{TopChrome, title_clearance};
use crate::coordinates::is_floating;
use crate::cover::z_of;
use crate::host::{BORDER, TITLE_START, title_bar_of, title_insets_of};
use crate::types::{Point, Rect};

use super::gesture::{Gesture, Kind};
use super::resize::grip_at;
use super::wm::Wm;

fn inside(r: Rect, at: Point) -> bool {
    at.x >= r.x && at.x < r.right() && at.y >= r.y && at.y < r.bottom()
}

impl Wm {
    /// The top chips' edges as the compositor draws them, which a fill's title keeps clear of.
    pub fn set_top_chrome(&mut self, top: TopChrome) {
        self.top = top;
    }

    /// The window topmost at `at` when it glides at `now`: its id, what a press there starts and
    /// where it is drawn.
    fn mid_glide(&self, at: Point, now: f64) -> Option<(String, Kind, Rect)> {
        let windows = self.drawn.windows();
        let focused = self.drawn.focused.as_deref();
        let mut stack: Vec<_> = (windows.iter().enumerate())
            .map(|(i, p)| (z_of(p, i, focused), p))
            .collect();
        stack.sort_by_key(|(level, _)| *level);
        let (_, p) = (stack.iter().rev())
            .find(|(_, p)| self.drawn_rect(&p.id, now).is_some_and(|r| inside(r, at)))?;
        let drawn = self.glides.get(&p.id).filter(|g| !g.done(now))?.at(now);
        let window = p.id.clone();
        if let Some(grip) = grip_at(drawn, at) {
            return Some((p.id.clone(), Kind::Resize { window, grip }, drawn));
        }
        // A pinned window's title bar moves nothing: the page's, as before.
        if p.pinned {
            return None;
        }
        let fill = p.fill.filter(|_| is_floating(p));
        let (start, end) = title_insets_of(title_clearance(fill, self.top));
        let bar = title_bar_of(drawn);
        // The icon starts past the switcher's clearance; the tools end the draggable part.
        let from = drawn.x + start - TITLE_START - BORDER;
        let title = Rect::new(from, bar.y, (drawn.right() - end - from).max(0.0), bar.h);
        inside(title, at).then(|| (p.id.clone(), Kind::Move { window }, drawn))
    }

    /// The press at `at` lands on a window gliding now (as last drawn): whether the window manager
    /// took it, ending the glide and starting the gesture from where the window is drawn.
    pub(super) fn press_mid_glide(&mut self, at: Point) -> bool {
        let Some((id, kind, drawn)) = self.mid_glide(at, self.clock) else {
            return false;
        };
        self.glides.remove(&id);
        self.stopped = Some((id, drawn));
        self.gesture = Some(Gesture::new(kind, at));
        true
    }

    /// The press that stopped a glide ended without placing the window: it glides on from where it
    /// stopped, starting `now`.
    pub(super) fn resume_glide(&mut self, now: f64) {
        if let Some((id, from)) = self.stopped.take() {
            self.glide(&id, from, now);
        }
    }
}
