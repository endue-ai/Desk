//! The desk's system surface in the compositor window (#55, ADR 0160): the runtime's page, the first
//! of the system surfaces the desk starts once the compositor is up (`desk_web::sender::System`). It
//! is a windowless browser drawn above every window (`system.rs`), see-through, on the desk's frame
//! clock; the plugin host in it reaches each plugin surface through the relay, and it frames none.

use cef::*;
use desk_web::sender::System;

use super::{CompositorWindow, PAGE};
use crate::web_host::render::SurfaceRender;
use crate::web_host::top;

impl CompositorWindow {
    /// Open the desk's system surface at `url`: the runtime's page.
    pub fn open_page(&mut self, url: &str) {
        debug_assert_eq!(PAGE, System::Desk.id());
        let sink = std::sync::Arc::new(self.shared.clone());
        let render = SurfaceRender::new(self.page.clone(), sink, self.host.room());
        let mut client = crate::client::compositor_page(
            self.desk.pump.clone(),
            std::sync::Arc::clone(&self.desk),
            render,
            self.relay.clone(),
        );
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
}

#[cfg(test)]
mod tests {
    use desk_web::sender::System;

    #[test]
    fn the_compositors_page_is_the_desks_system_surface() {
        assert_eq!(super::PAGE, System::Desk.id());
        assert_eq!(System::ALL[0], System::Desk, "the first the desk starts");
    }
}
