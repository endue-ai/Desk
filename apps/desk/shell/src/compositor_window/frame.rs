//! A frame of the compositor window (#249, ADR 0235): due on the display's beat (`clock.rs`), its
//! scene laid out again or drawn as it was (`compose.rs`), then handed to the render thread, which
//! draws it to the window or off screen (`render_thread.rs`); the main thread draws nothing.
//!
//! In development builds `compositor_input { busy: ms }` holds the main thread in a busy loop of
//! that long right after the next frame is handed, as a slow CEF task, bridge call or import
//! would: the motion gate's `busy` shake judges that it drops no frame (`frame_trace` `busy`).

use std::time::{Duration, Instant};

use super::composed::Shared;
use super::gpu::Gpu;
use super::render_thread::{Handed, RenderThread, Target};
use super::{CompositorWindow, clock};
use crate::frame_trace::{self, Timed};
use crate::web_host::frames;

/// The longest busy loop a check may ask for.
const MOST_BUSY: Duration = Duration::from_millis(500);

/// The window's render thread, drawing to `gpu`'s swapchain (taken from it) or off screen, with
/// `shared`'s compositor, at `rate` frames a second.
pub(super) fn start(gpu: &mut Gpu, shared: &Shared, rate: u32) -> RenderThread {
    let target = match gpu.swapchain.take() {
        Some(chain) => Target::Window(chain),
        None => Target::Unseen {
            render: frame_trace::on(),
        },
    };
    RenderThread::start(target, shared.clone(), frames::interval(rate))
}

impl CompositorWindow {
    /// The frame due at `now`: its scene, laid out again when the desk changed, to the render thread.
    pub(super) fn frame(&mut self, now: Instant) {
        let laid = self.shared.lock().dirty;
        // The motion gate's frame trace times each frame (#247, `frame_trace.rs`).
        let mut timed = Timed::begin(|| laid);
        self.scene_for_frame();
        timed.mark();
        self.composed += 1;
        let every = frames::interval(self.rate);
        self.last_frame = clock::Due::beat(self.last_frame, now, every);
        self.shared.lock().handed(self.composed);
        self.window.pre_present_notify();
        let handed = Handed {
            scene: laid.then(|| self.scene.clone()),
            slot: self.last_frame,
            timed,
            n: self.composed,
        };
        self.render.hand(handed);
        if let Some(busy) = self.busy.take() {
            busy_loop(busy);
        }
    }

    /// A check's busy loop of `ms`, right after the next frame is handed (development builds).
    pub fn busy(&mut self, ms: f64) {
        let ms = Duration::from_secs_f64(ms.max(0.0) / 1000.0);
        self.busy = Some(ms.min(MOST_BUSY));
    }

    /// The display's rate changed: the render thread draws at it from the next frame on.
    pub(super) fn render_rate(&self) {
        self.render.set_interval(frames::interval(self.rate));
    }
}

/// Hold the thread for `d`, as a task that runs that long would.
fn busy_loop(d: Duration) {
    let ms = d.as_secs_f64() * 1000.0;
    frame_trace::line("busy", serde_json::json!({ "ms": ms }));
    let start = Instant::now();
    while start.elapsed() < d {
        std::hint::spin_loop();
    }
}
