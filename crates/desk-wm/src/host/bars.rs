//! Where the bars float (ADR 0028, ADR 0132; `SAFE` in `geometry.rs`, the bars' CSS in
//! `packages/runtime/src/shell/{chrome,bottom,shell}.css`, Eris's place in `eris/eris.css`): the
//! band along each edge a bar sits in, and the free area between them where windows open and tile.
//! The bars float above every window, a filled one included: they never push a window aside, so
//! nothing here moves a window. What a bar shows (the agent bar, the rail, the profile switcher,
//! the composer) stays the page's system layer until #55; the compositor draws that layer above
//! the windows (`host::Plan::page`).

use serde::{Deserialize, Serialize};

use crate::geometry::{SAFE, free_area, free_top};
use crate::layout::DesktopLayout;
use crate::types::{Offset, Rect};

/// Eris's figure, 128 × 138 px; at home she is centred 40 px from the top.
pub const ERIS_W: f64 = 128.0;
pub const ERIS_H: f64 = 138.0;
const ERIS_TOP: f64 = 40.0;

/// The bands the bars float in on one desktop, in app pixels, and where windows open.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Bars {
    /// The profile switcher (left) and the desktops (right): the whole width, `SAFE.top` tall.
    pub top: Rect,
    /// The drawer button, the composer and the running chips: the whole width, `SAFE.bottom` tall.
    pub bottom: Rect,
    /// The agent bar, between the top and the bottom bands.
    pub left: Rect,
    /// The rail, while the desktop shows it.
    pub right: Option<Rect>,
    /// The drawer button in the bottom band's left end, while the desktop shows it.
    pub drawer: Option<Rect>,
    /// Eris's figure: at home, or where the person put her.
    pub eris: Rect,
    /// Eris sits at home, centred at the top, and windows open below her.
    pub eris_home: bool,
    /// Where windows open and tile: between the bands, under Eris while she is at home.
    pub free: Rect,
}

/// The drawer button: 24 px in from the left, 20 px up from the bottom, a 48 px square.
const DRAWER: f64 = 48.0;

/// The bars of a `vw`×`vh` app showing `layout`.
pub fn bars(vw: f64, vh: f64, layout: &DesktopLayout) -> Bars {
    let middle = (vh - SAFE.top - SAFE.bottom).max(0.0);
    let eris_home = layout.eris.is_none();
    let Offset { x, y } = layout
        .eris
        .unwrap_or(Offset::new((vw - ERIS_W) / 2.0, ERIS_TOP));
    Bars {
        top: Rect::new(0.0, 0.0, vw, SAFE.top),
        bottom: Rect::new(0.0, (vh - SAFE.bottom).max(0.0), vw, SAFE.bottom),
        left: Rect::new(0.0, SAFE.top, SAFE.left, middle),
        right: layout
            .rail
            .visible
            .then(|| Rect::new((vw - SAFE.right).max(0.0), SAFE.top, SAFE.right, middle)),
        drawer: layout
            .drawer
            .visible
            .then(|| Rect::new(24.0, (vh - 20.0 - DRAWER).max(0.0), DRAWER, DRAWER)),
        eris: Rect::new(x, y, ERIS_W, ERIS_H),
        eris_home,
        free: free_area(vw, vh, free_top(eris_home)),
    }
}

impl Bars {
    /// Every band a bar shows in, top, bottom, left, then the rail's.
    pub fn bands(&self) -> Vec<Rect> {
        let mut all = vec![self.top, self.bottom, self.left];
        all.extend(self.right);
        all
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::BELOW_ERIS;
    use crate::layout::Visible;

    #[test]
    fn eris_at_home_is_centred_and_the_free_area_starts_below_her() {
        let b = bars(1440.0, 900.0, &DesktopLayout::default());
        assert_eq!(b.eris, Rect::new(656.0, 40.0, 128.0, 138.0));
        assert!(b.eris_home);
        assert_eq!(b.free.y, BELOW_ERIS);
        assert!(b.eris.bottom() <= b.free.y);
    }

    #[test]
    fn a_hidden_rail_and_drawer_leave_no_band() {
        let layout = DesktopLayout {
            rail: Visible { visible: false },
            drawer: Visible { visible: false },
            ..DesktopLayout::default()
        };
        let b = bars(1280.0, 800.0, &layout);
        assert_eq!((b.right, b.drawer), (None, None));
        assert_eq!(b.bands().len(), 3);
    }
}
