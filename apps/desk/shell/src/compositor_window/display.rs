//! The display the compositor window is on, and its rate (#249, ADR 0235): the frames a second its
//! frames and the surfaces' begin frames follow, 60 or 120 on ProMotion. macOS says it through
//! `NSScreen.maximumFramesPerSecond` of the window's screen, or of the main screen while the
//! window is on none (off screen, the gates: no screen is needed, and its frames follow the main
//! display's). Other platforms keep 60 a second until they are measured (#61).

use winit::window::Window;

use super::CompositorWindow;
use crate::web_host::frames::{MOST_RATE, RATE};

/// The frames a second of the display `window` is on: 60 where it says none.
pub fn rate(window: &Window) -> u32 {
    said(window)
        .filter(|rate| *rate > 0)
        .map_or(RATE, |rate| rate.min(MOST_RATE))
}

#[cfg(target_os = "macos")]
fn said(window: &Window) -> Option<u32> {
    use objc2_app_kit::NSScreen;
    use objc2_foundation::MainThreadMarker;
    let mtm = MainThreadMarker::new()?;
    let screen = crate::float::mac::ns_window(window)
        .and_then(|ns| ns.screen())
        .or_else(|| NSScreen::mainScreen(mtm))?;
    u32::try_from(screen.maximumFramesPerSecond()).ok()
}

#[cfg(not(target_os = "macos"))]
fn said(_window: &Window) -> Option<u32> {
    None
}

impl CompositorWindow {
    /// The window may have moved to another display: its frames, and the surfaces' begin frames,
    /// follow that display's rate from the next frame on.
    pub(super) fn follow_display(&mut self) {
        let rate = rate(&self.window);
        if rate == self.rate {
            return;
        }
        eprintln!("endue Desk: the compositor draws {rate} frames a second, its display's");
        self.rate = rate;
        self.host.set_display(rate);
        self.render_rate();
        crate::frame_trace::line("display", serde_json::json!({ "hz": rate }));
    }
}
