//! The canvas under the normal windows (`packages/runtime/src/shell/Pan.ts`, ADR 0082): Shift +
//! drag on the empty background or on a window's title bar moves it, and the normal windows with
//! it; floating windows stay where they are. A wheel over the empty background moves it too.
//! Windows' contents, controls and plugin scroll areas keep their input, and a plain drag never
//! pans. The runtime read these from DOM events; the compositor's hit test names the target (#80).

use serde::{Deserialize, Serialize};

use crate::types::Offset;

/// What the pointer is over, as the pan sees it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PanTarget {
    /// The empty desk: the canvas itself or its glow.
    Background,
    /// A window's title bar, away from its buttons.
    TitleBar,
    /// A button or another control, in a title bar or a bar.
    Control,
    /// A window's content: a plugin's surface or a pane.
    Content,
}

/// How a wheel event counts its deltas (`WheelEvent.deltaMode`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WheelMode {
    Pixel,
    Line,
    Page,
}

/// The height of a line, for a wheel that counts lines.
const LINE: f64 = 16.0;

/// Whether a drag that starts over `target` pans: with Shift, on the background or a title bar.
pub fn drag_pans(shift: bool, target: PanTarget) -> bool {
    shift && matches!(target, PanTarget::Background | PanTarget::TitleBar)
}

/// Whether a wheel over `target` pans: over the empty background only, not a pinch (`ctrl`), and
/// not while something is dragged (`grabbing`).
pub fn wheel_pans(target: PanTarget, ctrl: bool, grabbing: bool) -> bool {
    target == PanTarget::Background && !ctrl && !grabbing
}

/// The pan after a wheel of `dx`, `dy` in `mode`: the canvas moves as it would scroll a page
/// `page` pixels high, lines being 16 pixels.
pub fn wheel_pan(pan: Offset, dx: f64, dy: f64, mode: WheelMode, page: f64) -> Offset {
    let scale = match mode {
        WheelMode::Pixel => 1.0,
        WheelMode::Line => LINE,
        WheelMode::Page => page,
    };
    Offset::new(pan.x - dx * scale, pan.y - dy * scale)
}

/// Whether the pointer over `target` shows the pan hint (the root's title in the runtime): the
/// empty canvas's alone, never a control's tooltip.
pub fn hint_shows(target: PanTarget) -> bool {
    target == PanTarget::Background
}

/// Whether the button that brings the canvas back to its origin shows.
pub fn reset_shows(pan: Offset) -> bool {
    pan.x != 0.0 || pan.y != 0.0
}

/// A pan by drag, from the pan its desktop had when it started. A desktop switched to meanwhile
/// is left where it is.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PanDrag {
    start: Offset,
    desktop: String,
}

impl PanDrag {
    pub fn start(pan: Offset, desktop: impl Into<String>) -> Self {
        Self {
            start: pan,
            desktop: desktop.into(),
        }
    }

    /// The pan with the pointer `dx`, `dy` from where it was pressed, while `desktop` is in front.
    pub fn moved(&self, dx: f64, dy: f64, desktop: &str) -> Option<Offset> {
        (desktop == self.desktop).then_some(Offset::new(self.start.x + dx, self.start.y + dy))
    }

    /// Escape: the pan it started from.
    pub fn cancelled(&self, desktop: &str) -> Option<Offset> {
        (desktop == self.desktop).then_some(self.start)
    }
}
