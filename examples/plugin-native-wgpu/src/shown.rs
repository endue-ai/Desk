//! What the plugin knows of its surface, and when it draws: while shown, at most at the desk's pace,
//! and never before the desk released the frame before (the frame's texture is the plugin's again
//! only then). Pure: the tests below run it without a GPU.

use std::time::{Duration, Instant};

/// The surface as the desk last described it.
#[derive(Debug, Clone, PartialEq)]
pub struct Shown {
    pub surface: String,
    /// Logical size and the display's scale.
    pub size: (u32, u32),
    pub scale: f64,
    pub hidden: bool,
    /// The most frames per second the desk wants.
    pub fps: u32,
    /// How far the scene turned, in radians: the state it keeps across sleeps.
    pub angle: f32,
    /// Allocations of its texture: a new pixel size is a new one.
    pub generation: u64,
    pub frame: u64,
    /// The frame the desk has not released yet.
    pub pending: Option<u64>,
    next: Instant,
}

impl Shown {
    pub fn new(surface: String, size: (u32, u32), scale: f64, hidden: bool, now: Instant) -> Shown {
        Shown {
            surface,
            size,
            scale,
            hidden,
            fps: 60,
            angle: 0.0,
            generation: 1,
            frame: 0,
            pending: None,
            next: now,
        }
    }

    /// The texture's size in pixels: logical size times scale, rounded.
    pub fn pixels(&self) -> (u32, u32) {
        let px = |n: u32| ((f64::from(n) * self.scale).round() as u32).max(1);
        (px(self.size.0), px(self.size.1))
    }

    /// A new size or scale; whether the texture must be made again.
    pub fn resize(&mut self, size: (u32, u32), scale: f64) -> bool {
        let before = self.pixels();
        self.size = size;
        self.scale = scale;
        let changed = self.pixels() != before;
        if changed {
            self.generation += 1;
        }
        changed
    }

    /// Whether a frame is due now.
    pub fn due(&self, now: Instant) -> bool {
        !self.hidden && self.pending.is_none() && now >= self.next
    }

    /// How long the plugin may wait for the desk before its next frame; `None` while it has none
    /// to draw (hidden, or waiting for a release, which is a message).
    pub fn wait(&self, now: Instant) -> Option<Duration> {
        if self.hidden || self.pending.is_some() {
            return None;
        }
        Some(self.next.saturating_duration_since(now))
    }

    /// A frame was drawn and attached at `now`: its number.
    pub fn drew(&mut self, now: Instant) -> u64 {
        self.frame += 1;
        self.pending = Some(self.frame);
        self.next = now + Duration::from_secs_f64(1.0 / f64::from(self.fps.max(1)));
        self.frame
    }

    /// The desk is done with `frame`.
    pub fn released(&mut self, frame: u64) {
        if self.pending == Some(frame) {
            self.pending = None;
        }
    }

    /// Turn the scene by `seconds` at `speed` turns per ten seconds.
    pub fn turn(&mut self, seconds: f32, speed: f32) {
        self.angle =
            (self.angle + std::f32::consts::TAU * speed / 10.0 * seconds) % std::f32::consts::TAU;
    }
}

#[cfg(test)]
mod tests {
    use super::Shown;
    use std::time::{Duration, Instant};

    #[test]
    fn it_draws_while_shown_at_its_pace_and_only_after_the_last_frame_came_back() {
        let now = Instant::now();
        let mut shown = Shown::new(
            "main.example-native--wgpu".into(),
            (400, 300),
            2.0,
            false,
            now,
        );
        assert_eq!(shown.pixels(), (800, 600));
        assert!(shown.due(now));
        shown.fps = 30;
        let frame = shown.drew(now);
        assert!(
            !shown.due(now + Duration::from_secs(1)),
            "waits for its release"
        );
        assert_eq!(shown.wait(now), None);
        shown.released(frame + 1);
        assert_eq!(shown.pending, Some(frame), "another frame's release");
        shown.released(frame);
        assert!(!shown.due(now + Duration::from_millis(10)), "a 30 fps pace");
        assert!(shown.due(now + Duration::from_millis(34)));
        shown.hidden = true;
        assert!(!shown.due(now + Duration::from_secs(1)));
        assert_eq!(shown.wait(now), None);
    }

    #[test]
    fn a_new_pixel_size_is_a_new_generation_and_the_angle_turns_and_wraps() {
        let mut shown = Shown::new("s".into(), (400, 300), 1.0, false, Instant::now());
        assert!(!shown.resize((400, 300), 1.0));
        assert!(shown.resize((400, 300), 2.0));
        assert_eq!(shown.generation, 2);
        shown.turn(10.0, 1.0);
        assert!(
            shown.angle.abs() < 1e-3,
            "a whole turn in ten seconds at speed 1"
        );
        shown.turn(2.5, 1.0);
        assert!((shown.angle - std::f32::consts::FRAC_PI_2).abs() < 1e-3);
    }
}
