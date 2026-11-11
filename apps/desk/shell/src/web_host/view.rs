//! What one off-screen browser lays out and paints at, and what it painted. Its render handler reads
//! the size and scale and counts every paint; its host changes them on `resize`, `hide` and `show`.

/// A surface's tree for screen readers, the protocol's `a11y.*` (#57), kept with its view.
#[path = "a11y.rs"]
pub mod a11y;

use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::stall::Watch;

/// A surface's paints, for the compositor's stats and the probe (a hidden surface paints nothing).
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Counts {
    /// Shared-texture paints that reached the compositor.
    pub paints: u64,
    /// Paints that came while the surface was hidden (should stay 0).
    pub hidden_paints: u64,
    /// Software paints: the shared-texture path was off (no GPU), uploaded instead.
    pub software_paints: u64,
    pub import_errors: u64,
    pub last_error: Option<String>,
    /// From the browser's creation (or its last wake) to its first paint.
    pub first_paint_ms: Option<u64>,
    /// The last frame's texture size, in pixels.
    pub texture: Option<(u32, u32)>,
    /// The last frame's damage, in texture pixels.
    pub damage_px: u64,
    /// Begin frames the desk's clock sent it (`clock.rs`): none while hidden or asleep.
    pub begin_frames: u64,
    /// Times its page stopped painting though it took begin frames and asked for them (#157,
    /// `stall.rs`); whether it is stalled now; and the loads that brought it back.
    pub stalls: u64,
    pub stalled: bool,
    pub stall_reloads: u64,
}

/// One surface's layout and paint state.
#[derive(Debug)]
pub struct View {
    pub surface: String,
    /// Logical pixels.
    pub size: (u32, u32),
    pub scale: f32,
    pub hidden: bool,
    /// Counts up with every attach.
    pub frame: u64,
    /// Counts the texture sizes seen: a new size is a new generation of the producer's textures.
    pub generation: u64,
    last_size: Option<(u32, u32)>,
    started: Instant,
    pub counts: Counts,
    /// Whether its page stopped painting (#157).
    pub watch: Watch,
    /// The scale its browser last read from its screen info: a resize tells it the screen only when
    /// the scale changes (`rescaled`).
    screen_scale: f32,
    /// Its accessibility export (#57), kept across its browsers.
    pub a11y: a11y::Exports,
}

impl View {
    pub fn new(surface: &str, size: (u32, u32), scale: f32, hidden: bool) -> View {
        View {
            surface: surface.to_owned(),
            size,
            scale,
            hidden,
            frame: 0,
            generation: 0,
            last_size: None,
            started: Instant::now(),
            counts: Counts::default(),
            watch: Watch::default(),
            screen_scale: scale,
            a11y: Default::default(),
        }
    }

    /// A browser starts painting from now (created, woken or loaded again), at the view's scale.
    pub fn restart(&mut self) {
        self.started = Instant::now();
        self.counts.first_paint_ms = None;
        self.counts.stalled = false;
        self.watch.restart();
        self.screen_scale = self.scale;
    }

    /// Whether the scale changed since its browser last read its screen info, which it reads now.
    /// A new size alone needs no screen info: CEF holds a resize until the page painted the one
    /// before, and a screen info change lays the page out again past that hold, so a glide's
    /// resizes put several new sizes in flight in one frame; after them CEF sent the page no begin
    /// frame again (#157, ADR XXXX).
    pub fn rescaled(&mut self) -> bool {
        let changed = self.screen_scale != self.scale;
        self.screen_scale = self.scale;
        changed
    }

    /// The next frame of a texture `size` pixels: its frame number and generation.
    pub fn next_frame(&mut self, size: (u32, u32)) -> (u64, u64) {
        if self.last_size != Some(size) {
            self.last_size = Some(size);
            self.generation += 1;
        }
        self.frame += 1;
        if self.counts.first_paint_ms.is_none() {
            let since = self.started.elapsed().min(Duration::from_secs(3600));
            self.counts.first_paint_ms = Some(since.as_millis() as u64);
        }
        if self.hidden {
            self.counts.hidden_paints += 1;
        }
        self.counts.texture = Some(size);
        (self.frame, self.generation)
    }

    /// The view in pixels: what the texture will be.
    pub fn pixels(&self) -> (u32, u32) {
        let scale = f64::from(self.scale.max(0.25));
        (
            (f64::from(self.size.0) * scale).round() as u32,
            (f64::from(self.size.1) * scale).round() as u32,
        )
    }
}

/// A view shared by a browser's handlers and its host.
#[derive(Clone, Debug)]
pub struct SharedView(Arc<Mutex<View>>);

impl SharedView {
    pub fn new(view: View) -> SharedView {
        SharedView(Arc::new(Mutex::new(view)))
    }

    /// Lock it; never across a call into CEF, which may call back into the handlers.
    pub fn lock(&self) -> MutexGuard<'_, View> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::View;

    #[test]
    fn a_new_texture_size_is_a_new_generation_and_hidden_paints_are_counted() {
        let mut view = View::new("s", (400, 300), 2.0, false);
        assert_eq!(view.pixels(), (800, 600));
        assert_eq!(view.next_frame((800, 600)), (1, 1));
        assert_eq!(view.next_frame((800, 600)), (2, 1));
        assert_eq!(view.next_frame((1000, 600)), (3, 2), "a resize");
        assert!(view.counts.first_paint_ms.is_some());
        assert_eq!(view.counts.hidden_paints, 0);
        view.hidden = true;
        view.next_frame((1000, 600));
        assert_eq!(view.counts.hidden_paints, 1);
    }

    #[test]
    fn a_resize_tells_the_screen_only_when_the_scale_changes() {
        let mut view = View::new("s", (400, 300), 2.0, false);
        view.size = (900, 700);
        assert!(!view.rescaled(), "a new size alone (#157)");
        view.scale = 1.0;
        assert!(view.rescaled(), "a new scale");
        assert!(!view.rescaled(), "told once");
        view.scale = 2.0;
        view.restart();
        assert!(
            !view.rescaled(),
            "a new browser reads its screen when it starts"
        );
    }
}
