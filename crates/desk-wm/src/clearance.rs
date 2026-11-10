//! A filled window's title clear of the top chips (`packages/runtime/src/surface/clearance.ts` and
//! the rules in `surface/surface.css` that read it, ADR 0132). A window that fills the app, or its
//! top half or a top quarter, has its title bar under the profile switcher and the desktops, which
//! float above every window. These insets keep its title and tools clear of them.
//!
//! The runtime measured the two chips from the DOM whenever they or the app changed size; here the
//! caller passes their edges as it draws them (the compositor's chrome, #51), and pads the title by
//! the larger of its own padding and the inset.

use serde::{Deserialize, Serialize};

use crate::math::round;
use crate::types::Fill;

/// Beyond the chips' edges.
const GAP: f64 = 12.0;

/// How far from each side of the app the top chips reach, a gap included (`--chrome-left`,
/// `--chrome-right`); `None` for a chip that is not drawn.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TopChrome {
    pub left: Option<f64>,
    pub right: Option<f64>,
}

impl TopChrome {
    /// From an app `width` wide, the profile switcher's right edge and the desktops' left edge.
    pub fn measure(width: f64, switcher_right: Option<f64>, desktops_left: Option<f64>) -> Self {
        Self {
            left: switcher_right.map(|right| round(right) + GAP),
            right: desktops_left.map(|left| round(width - left) + GAP),
        }
    }
}

/// What a window's title keeps clear of, at its start and its end.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TitleClearance {
    pub left: Option<f64>,
    pub right: Option<f64>,
}

/// The insets a window filling `fill` gives its title: the switcher's at the start for the whole
/// app, the top or the left (a left half reaches the top too), the desktops' at the end for the
/// whole app, the top or the right. A window that fills nothing, or a bottom part, needs none.
pub fn title_clearance(fill: Option<Fill>, chrome: TopChrome) -> TitleClearance {
    let starts_top_left = matches!(
        fill,
        Some(Fill::Full | Fill::Left | Fill::Top | Fill::TopLeft)
    );
    let starts_top_right = matches!(
        fill,
        Some(Fill::Full | Fill::Right | Fill::Top | Fill::TopRight)
    );
    TitleClearance {
        left: chrome.left.filter(|_| starts_top_left),
        right: chrome.right.filter(|_| starts_top_right),
    }
}
