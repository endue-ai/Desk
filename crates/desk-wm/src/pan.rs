//! The canvas under the normal windows (`packages/runtime/src/shell/Pan.ts`, ADR 0082): Shift +
//! drag on the empty background or on a window's title bar moves it, and the normal windows with
//! it; floating windows stay where they are. A wheel over the empty background moves it too.
//! Windows' contents, controls and plugin scroll areas keep their input, and a plain drag never
//! pans. The runtime read these from DOM events; the compositor's hit test names the target (#80).

use serde::{Deserialize, Serialize};

use crate::types::{Offset, Point};

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

/// How far a canvas goes from its origin, either way on each axis, in CSS pixels: a square two
/// hundred thousand pixels a side, some fifty 4K screens across. A canvas without an end let a
/// held wheel or a long drag take the windows where nothing brings them back into sight but the
/// reset, and a pan grown past what a 32-bit float holds exactly would place windows off the
/// pixels the compositor draws on.
pub const EXTENT: f64 = 100_000.0;

/// `pan` within the canvas's extent. Every pan the window manager keeps goes through here: a
/// wheel's, a drag's, the map's, a reveal's, an edit's and a restored session's.
pub fn bounded(pan: Offset) -> Offset {
    let axis = |v: f64| {
        if v.is_nan() {
            0.0
        } else {
            v.clamp(-EXTENT, EXTENT)
        }
    };
    Offset::new(axis(pan.x), axis(pan.y))
}

/// How long a run of wheels that pans the canvas lasts after its last wheel, in milliseconds: as
/// long as Chromium keeps a mouse wheel's scroll with the scroller it began on (the wheel latching
/// transaction of its `mouse_wheel_phase_handler.h`), within which the wheels of one gesture and
/// its momentum, or of one turn of a mouse's wheel, all fall.
pub const LATCH_MS: f64 = 500.0;

/// How far the pointer may go from where the run began, in CSS pixels, before the next wheel is
/// a new one's: the slop Chromium allows within one such scroll. A pointer taken to a window
/// scrolls that window.
pub const LATCH_SLOP: f64 = 10.0;

/// A run of wheels that pans the canvas. A wheel pans where it began: over the empty background.
/// As the canvas moves, a window comes under the pointer, and the next wheel of the same turn
/// went to that window and the pan stopped. While the run lasts its wheels pan, whatever lies
/// under the pointer now; it ends `LATCH_MS` after its last wheel, once the pointer has left
/// where it began by more than `LATCH_SLOP`, or at once (`end`: a press, a pinch).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WheelLatch {
    /// Where the pointer was when the run began, and when its last wheel came (milliseconds).
    run: Option<(Point, f64)>,
}

impl WheelLatch {
    /// A wheel at `at` panned the canvas at `now`: the run goes on, or one begins there.
    pub fn panned(&mut self, at: Point, now: f64) {
        let from = match self.run {
            Some((from, _)) if self.holds(at, now) => from,
            _ => at,
        };
        self.run = Some((from, now));
    }

    /// Whether a wheel at `at` at `now` is the run's, and so pans whatever it is over.
    pub fn holds(&self, at: Point, now: f64) -> bool {
        let Some((from, last)) = self.run else {
            return false;
        };
        let near = (at.x - from.x).abs() <= LATCH_SLOP && (at.y - from.y).abs() <= LATCH_SLOP;
        near && now >= last && now - last <= LATCH_MS
    }

    /// The run is over: the next wheel goes to what it is over.
    pub fn end(&mut self) {
        self.run = None;
    }
}

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
    bounded(Offset::new(pan.x - dx * scale, pan.y - dy * scale))
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
        (desktop == self.desktop)
            .then_some(bounded(Offset::new(self.start.x + dx, self.start.y + dy)))
    }

    /// The desktop whose canvas it pans.
    pub fn desktop(&self) -> &str {
        &self.desktop
    }

    /// Escape: the pan it started from.
    pub fn cancelled(&self, desktop: &str) -> Option<Offset> {
        (desktop == self.desktop).then_some(self.start)
    }
}
