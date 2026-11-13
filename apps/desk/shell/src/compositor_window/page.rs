//! The desk's system surface in the compositor window (#55, ADR 0160): the runtime's page, the first
//! of the system surfaces the desk starts once the compositor is up (`desk_web::sender::System`). It
//! is a windowless browser drawn above every window (`system.rs`), see-through, on the desk's frame
//! clock; the plugin host in it reaches each plugin surface through the relay, and it frames none.

use cef::*;
use desk_web::sender::System;

use std::time::Instant;

use super::hosted::Outcome;
use super::{CompositorWindow, PAGE};
use crate::web_host::render::SurfaceRender;
use crate::web_host::top;
use crate::web_host::view::View;

impl CompositorWindow {
    /// Open the desk's system surface at `url`: the runtime's page.
    pub fn open_page(&mut self, url: &str) {
        debug_assert_eq!(PAGE, System::Desk.id());
        let sink = std::sync::Arc::new(self.shared.clone());
        let render = SurfaceRender::new(self.page.clone(), sink, self.host.room());
        let client = crate::client::compositor_page(
            self.desk.pump.clone(),
            std::sync::Arc::clone(&self.desk),
            render,
            self.relay.clone(),
            self.host.clone(),
        );
        // A right click in one of its fields gets the field menu (#156).
        let mut client = crate::web_host::field_menu::client(client, self.page.clone());
        let info = WindowInfo {
            windowless_rendering_enabled: 1,
            shared_texture_enabled: i32::from(std::env::var_os("DESK_SURFACE_SOFTWARE").is_none()),
            external_begin_frame_enabled: 1,
            ..Default::default()
        };
        // See through: the compositor draws the wallpaper and the windows under the page.
        let settings = BrowserSettings {
            windowless_frame_rate: 60,
            background_color: 0,
            ..Default::default()
        };
        let browser = browser_host_create_browser_sync(
            Some(&info),
            Some(&mut client),
            Some(&url.into()),
            Some(&settings),
            None,
            None,
        );
        // The runtime's page hears every plugin surface's messages, and frames none.
        top::set_shell_page(browser.as_ref().map(|b| b.identifier()));
        self.relay.page(browser.clone());
        self.host.clock_page(browser.clone(), self.page.clone());
        self.browser = browser;
    }

    /// What the page painted since the last look: the windows its picture shows where its DOM has
    /// them are drawn from there (`PageShown`).
    pub(super) fn page_painted(&mut self, now: Instant) {
        let painted = std::mem::take(&mut self.shared.lock().page_damage);
        let scale = self.window.scale_factor().max(f64::MIN_POSITIVE);
        for damage in painted {
            let css: Vec<desk_wm::Rect> = (damage.iter())
                .map(|r| {
                    let px = |v: u64| v as f64 / scale;
                    desk_wm::Rect::new(px(r.x), px(r.y), px(r.width), px(r.height))
                })
                .collect();
            let outcome = self.hosted.page_painted(&css, now);
            if outcome != Outcome::default() {
                self.carry(outcome);
            }
        }
        if self.hosted.take_restaged() {
            self.shared.lock().dirty = true;
        }
    }

    /// The app window has a new size (logical pixels) or scale: the desk's page lays out again at
    /// it. Its browser hears the screen only for a new scale, as a plugin surface's does (ADR 0170):
    /// told it with every resize, an app window dragged to a new size put several sizes in flight
    /// in one frame and the desk's page never painted again (#157).
    pub(super) fn page_resized(&mut self, size: (u32, u32), scale: f32) {
        let rescaled = laid_out(&mut self.page.lock(), size, scale);
        if let Some(host) = self.browser.as_ref().and_then(|b| b.host()) {
            if rescaled {
                host.notify_screen_info_changed();
            }
            host.was_resized();
        }
    }
}

/// `view` laid out at `size` and `scale`: whether its browser reads its screen info again.
fn laid_out(view: &mut View, size: (u32, u32), scale: f32) -> bool {
    view.size = size;
    view.scale = scale;
    view.rescaled()
}

#[cfg(test)]
mod tests {
    use desk_web::sender::System;

    use super::{View, laid_out};

    #[test]
    fn the_compositors_page_is_the_desks_system_surface() {
        assert_eq!(super::PAGE, System::Desk.id());
        assert_eq!(System::ALL[0], System::Desk, "the first the desk starts");
    }

    #[test]
    fn an_app_window_resized_tells_the_desks_page_the_screen_only_for_a_new_scale() {
        let mut page = View::new(super::PAGE, (1280, 800), 2.0, false);
        for size in [(1300, 812), (1800, 1200), (2361, 1588)] {
            assert!(!laid_out(&mut page, size, 2.0), "a new size alone (#157)");
            assert_eq!(page.size, size);
        }
        assert!(laid_out(&mut page, (2361, 1588), 1.0), "a new scale");
        assert!(!laid_out(&mut page, (2361, 1588), 1.0), "told once");
    }
}
