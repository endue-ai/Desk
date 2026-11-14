//! A wheel's run on the canvas (ADR 0082, ADR 0218). A wheel pans the canvas where the page says
//! so: over the empty background, which only the page's DOM tells from a control. That first wheel
//! comes back from the page as its own step (`pan-by`), and from then on the run is the window's:
//! each wheel of it pans here, in the turn of the event loop it arrives in, and goes to no page.
//!
//! Before, every wheel went the round of the page: to its renderer, its listener, an edit worked
//! out from the page's copy of the pan, and back. A wheel that came before the last one's publish
//! was worked out from the same pan and overwrote it, so a fast pan moved in uneven steps and fell
//! short of the wheel; and as the canvas moved, a window came under the pointer, the next wheel
//! went to that window, and the pan stopped under a wheel still turning. A run lasts until it
//! rests (`desk_wm::LATCH_MS` after its last wheel), the pointer leaves where it began
//! (`LATCH_SLOP`), a button goes down or Control is held (a pinch zooms what it is over).

use std::time::Instant;

use desk_compositor::input::Input;
use desk_surface::generated::SurfaceWheelUnit;
use desk_wm::{Offset, Point, WheelLatch, WheelMode, wheel_pan};

use super::CompositorWindow;

/// The run of wheels that pans the canvas now, if one does.
#[derive(Debug)]
pub struct Panning {
    latch: WheelLatch,
    /// What the run's milliseconds count from.
    since: Instant,
    /// The desktop the run pans and where it has its canvas, before whole device pixels: a wheel
    /// of less than a pixel counts toward the next.
    to: Option<(String, Offset)>,
    /// Control is held.
    ctrl: bool,
}

impl Default for Panning {
    fn default() -> Self {
        Panning {
            latch: WheelLatch::default(),
            since: Instant::now(),
            to: None,
            ctrl: false,
        }
    }
}

impl Panning {
    fn ms(&self, now: Instant) -> f64 {
        now.saturating_duration_since(self.since).as_secs_f64() * 1000.0
    }

    fn end(&mut self) {
        self.latch.end();
        self.to = None;
    }

    /// Whether a run pans now, for checks (`compositor_input_state`).
    pub fn running(&self, at: Point, now: Instant) -> bool {
        self.to.is_some() && !self.ctrl && self.latch.holds(at, self.ms(now))
    }
}

impl CompositorWindow {
    /// The pointer, in the app's CSS pixels.
    pub(super) fn pointer_css(&self) -> Point {
        let scale = self.window.scale_factor();
        let at = self.router.pointer_state().2;
        Point::new(f64::from(at.x) / scale, f64::from(at.y) / scale)
    }

    /// The page's wheel panned the canvas (its `pan-by`, applied): a run begins where the pointer
    /// is, or goes on, from where the window manager has the canvas now.
    pub(super) fn wheel_panned(&mut self, now: Instant) {
        let at = self.pointer_css();
        let desk = self.hosted.wm.desk();
        let here = desk.here();
        let pan = desk.pan_of(&here);
        let panning = &mut self.gestures.panning;
        panning.to = Some((here, pan));
        let ms = panning.ms(now);
        panning.latch.panned(at, ms);
    }

    /// What a wheel's run makes of `input`: a wheel of the run pans the canvas at once, whatever
    /// lies under the pointer, and nothing else hears it (`true`); a press or Control ends the run.
    pub(super) fn pan_input(&mut self, input: &Input) -> bool {
        let (dx, dy, unit) = match input {
            Input::Wheel { dx, dy, unit } => (*dx, *dy, unit),
            Input::PointerButton { pressed: true, .. } => {
                self.gestures.panning.end();
                return false;
            }
            Input::Modifiers(held) => {
                self.gestures.panning.ctrl = held.ctrl;
                if held.ctrl {
                    self.gestures.panning.end();
                }
                return false;
            }
            _ => return false,
        };
        let now = Instant::now();
        let at = self.pointer_css();
        let here = self.hosted.wm.desk().here();
        let panning = &self.gestures.panning;
        let ms = panning.ms(now);
        let run = (panning.to.as_ref())
            .filter(|(desktop, _)| *desktop == here && panning.running(at, now))
            .map(|(_, from)| *from);
        let Some(from) = run else {
            self.gestures.panning.end();
            return false;
        };
        let scale = self.window.scale_factor();
        let (mode, dx, dy) = match unit {
            SurfaceWheelUnit::Pixel => (WheelMode::Pixel, dx / scale, dy / scale),
            SurfaceWheelUnit::Line => (WheelMode::Line, dx, dy),
            SurfaceWheelUnit::Page => (WheelMode::Page, dx, dy),
        };
        let to = wheel_pan(from, dx, dy, mode, self.hosted.wm.screen().h);
        let panning = &mut self.gestures.panning;
        panning.to = Some((here, to));
        panning.latch.panned(at, ms);
        self.map_pan(to);
        true
    }
}
