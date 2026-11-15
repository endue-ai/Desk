//! What a plugin's manifest asks of its window (`SurfaceWindow` in `specs/plugin/v0`, ADR 0226): the
//! size it first opens with, the smallest the person can make it, and whether the person can
//! resize it at all. The runtime hands them over with the plugin's surface (`Edit::Adopt`), so a
//! window of one plugin has them on the canvas; the shell reads the same manifest for the window
//! out of it. They are sizes of the plugin's page: on the canvas the window is its title bar and
//! border larger. Hints only: a place a profile or a session saved, a fill, a snap and tile size the
//! window as they always did, and a window of several panes follows its panes alone.

use serde::{Deserialize, Serialize};

use crate::desk::Desk;
use crate::host::{BORDER, TITLE};
use crate::pane_min::window_min;
use crate::types::{Placement, Rect, Size};

/// A plugin's window hints, as sizes of its page.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct WindowHints {
    /// The page the first time the window opens; `None`: its slot's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<Size>,
    /// The smallest page; `None`: the desk's minimum.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<Size>,
    /// The person cannot resize the window by its edges.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub fixed: bool,
}

/// The window round a page `page` large: its border and its title bar added.
fn framed(page: Size) -> Size {
    Size {
        w: page.w + 2.0 * BORDER,
        h: page.h + 2.0 * BORDER + TITLE,
    }
}

impl WindowHints {
    /// The smallest the window gets: `least`, or the hinted page's window when that is larger.
    pub fn least(&self, least: Size) -> Size {
        let asked = self.min.map_or(least, framed);
        Size {
            w: least.w.max(asked.w),
            h: least.h.max(asked.h),
        }
    }

    /// Where the window first opens: at its slot `slot` with the hinted page's size, never under
    /// `least`, moved up and left as far as it takes to stay inside `area` where it fits.
    pub fn first(&self, slot: Rect, area: Rect, least: Size) -> Rect {
        let Some(size) = self.size.map(framed) else {
            return slot;
        };
        let least = self.least(least);
        let (w, h) = (size.w.max(least.w), size.h.max(least.h));
        let x = slot.x.min(area.right() - w).max(area.x);
        let y = slot.y.min(area.bottom() - h).max(area.y);
        Rect::new(x, y, w, h)
    }
}

impl Desk {
    /// The runtime handed plugin `id`'s surface over with these hints (after `adopt`).
    pub fn hint(&mut self, id: &str, hints: Option<WindowHints>) {
        if let Some(a) = self.adopted.iter_mut().find(|a| a.id == id) {
            a.hints = hints;
        }
    }

    /// The hints window `p` has: its plugin's, while it shows that plugin's surface and nothing
    /// else.
    pub fn hints_of(&self, p: &Placement) -> Option<WindowHints> {
        let panes = p.panes();
        let [(_, view)] = panes.leaves()[..] else {
            return None;
        };
        let shown = self.resolve(p, view);
        let plugin = shown.strip_prefix(crate::placed::PLUGIN_VIEW)?;
        self.adopted.iter().find(|a| a.id == plugin)?.hints
    }

    /// The smallest window `p` gets: its panes' room (`window_min`), or its plugin's hint when
    /// that is larger.
    pub fn least_of(&self, p: &Placement) -> Size {
        let least = window_min(&p.panes());
        self.hints_of(p).map_or(least, |h| h.least(least))
    }

    /// Whether the person can resize window `p` by its edges.
    pub fn resizable(&self, p: &Placement) -> bool {
        !self.hints_of(p).is_some_and(|h| h.fixed)
    }
}
