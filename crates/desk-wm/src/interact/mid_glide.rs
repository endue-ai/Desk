//! A press on a window the compositor draws mid-glide (#124). The page lays every window out where
//! its placement puts it, so while one glides into its part the page's DOM, and its grab, cannot
//! say what a press on it means where the person sees it. The window manager finds that on the
//! rectangle being drawn, as the person sees it: one of its grips resizes the window, its title bar
//! away from its tools moves it. The glide ends at once: the window stays where it was drawn while
//! the press holds it, and a drag takes it from there; a press that never drags, or a drag
//! cancelled, lets it glide on from there. Anything else under the press is the page's and the
//! surfaces' as before, a part of the system layer drawn over the window (the top chips) among
//! them.

use crate::clearance::{TopChrome, title_clearance};
use crate::coordinates::is_floating;
use crate::host::{title_bar_of, title_insets_of};
use crate::types::{Placement, Point, Rect};

use super::gesture::{Gesture, Kind};
use super::resize::grip_at;
use super::wm::Wm;

pub(super) fn inside(r: Rect, at: Point) -> bool {
    at.x >= r.x && at.x < r.right() && at.y >= r.y && at.y < r.bottom()
}

impl Wm {
    /// The top chips' edges as the compositor draws them, which a fill's title keeps clear of.
    pub fn set_top_chrome(&mut self, top: TopChrome) {
        self.top = top;
    }

    /// The system layer's parts where the compositor draws them, above every window.
    pub fn set_system_parts(&mut self, parts: Vec<Rect>) {
        self.parts = parts;
    }

    /// The window topmost at `at` when it glides at `now`: its id, what a press there starts and
    /// where it is drawn.
    fn mid_glide(&self, at: Point, now: f64) -> Option<(String, Kind, Rect)> {
        // The system layer is drawn above every window: what a press on it means is the page's.
        if self.parts.iter().any(|r| inside(*r, at)) {
            return None;
        }
        let (p, _) = self.topmost_at(at, now)?;
        let p = &p;
        let drawn = self.glides.get(&p.id).filter(|g| !g.done(now))?.at(now);
        let window = p.id.clone();
        if let Some(grip) = grip_at(drawn, at) {
            return Some((p.id.clone(), Kind::Resize { window, grip }, drawn));
        }
        // A pinned window's title bar moves nothing: the page's, as before.
        if p.pinned {
            return None;
        }
        let title = self.title_stretch(p, drawn);
        inside(title, at).then(|| (p.id.clone(), Kind::Move { window }, drawn))
    }

    /// The part of `p`'s title bar, drawn at `drawn`, that a press drags it by. The bar drags from
    /// its left edge: the switcher's clearance moves a fill's icon and title in, not where the bar
    /// starts, and the chips themselves are parts of the system layer (#139). The tools, moved in
    /// by the desktops' clearance, end the draggable part.
    pub(super) fn title_stretch(&self, p: &Placement, drawn: Rect) -> Rect {
        let fill = p.fill.filter(|_| is_floating(p));
        let (_, end) = title_insets_of(title_clearance(fill, self.top));
        let bar = title_bar_of(drawn);
        let from = drawn.x;
        Rect::new(from, bar.y, (drawn.right() - end - from).max(0.0), bar.h)
    }

    /// The window topmost at `at` as drawn at `now`, and where it is drawn.
    pub(super) fn topmost_at(&self, at: Point, now: f64) -> Option<(Placement, Rect)> {
        let windows = self.drawn.windows();
        let stack = (self.drawn.used).stack(&windows, self.drawn.focused.as_deref());
        (stack.iter().rev()).find_map(|(_, p)| {
            let drawn = self.drawn_rect(&p.id, now).filter(|r| inside(*r, at))?;
            Some(((*p).clone(), drawn))
        })
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
