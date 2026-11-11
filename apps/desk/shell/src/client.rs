//! The browsers' client, one per window: it answers the pages' bridge calls (`host`) knowing which
//! window the browser is for (`Role`, which no page can change), tells the event loop when the
//! browser closed and, in development builds, prints the page's console to the terminal (CSP reports
//! land there too). The main window's page, the desk's system surface, renders off screen and posts
//! to each plugin surface through the relay (`compositor_page`, ADR 0160); the Eris window's clears the page's base colour so she stands on nothing
//! (macOS, ADR 0121).

// `wrap_client!` makes a constructor with one argument per field.
#![allow(clippy::too_many_arguments)]

use std::sync::Arc;

use cef::*;
use desk_web::sender::Role;

use crate::host::{self, Desk};
use crate::pump::{Pump, Wake};
use crate::renderer::{CALL, POST, WAKE};
use crate::web_host::relay::Relay;

wrap_life_span_handler! {
    pub struct ShellLifeSpan {
        role: Role,
        pump: Pump,
        windowless: bool,
    }

    impl LifeSpanHandler {
        // CEF's own close would ask the browser's top-level window to close (`performClose:`,
        // `WM_CLOSE`, `delete_event`), and a winit window only reports that: the main one would
        // merely hide, and no browser would ever finish closing. The shell drops the window itself.
        // An off-screen browser (compositor mode) has no window: CEF destroys it when told to go on.
        fn do_close(&self, _browser: Option<&mut Browser>) -> ::std::os::raw::c_int {
            self.pump.wake(Wake::Closing(self.role));
            i32::from(!self.windowless)
        }

        fn on_before_close(&self, _browser: Option<&mut Browser>) {
            self.pump.wake(Wake::Closed(self.role));
        }
    }
}

wrap_display_handler! {
    pub struct ShellDisplay {
        role: Role,
    }

    impl DisplayHandler {
        fn on_console_message(
            &self,
            _browser: Option<&mut Browser>,
            _level: LogSeverity,
            message: Option<&CefString>,
            source: Option<&CefString>,
            line: ::std::os::raw::c_int,
        ) -> ::std::os::raw::c_int {
            if cfg!(debug_assertions)
                && let Some(message) = message
            {
                let source = source.map(|s| s.to_string()).unwrap_or_default();
                eprintln!("shell console ({:?}): {message} ({source}:{line})", self.role);
            }
            0
        }
    }
}

/// Chromium paints a windowed browser's page on an opaque base colour; the DevTools protocol's
/// override makes it transparent, so the transparent window around Eris shows only her.
const CLEAR_BASE: &[u8] = br#"{"id":1,"method":"Emulation.setDefaultBackgroundColorOverride","params":{"color":{"r":0,"g":0,"b":0,"a":0}}}"#;

wrap_load_handler! {
    pub struct ClearBase;

    impl LoadHandler {
        fn on_load_end(
            &self,
            browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            _http_status_code: ::std::os::raw::c_int,
        ) {
            if frame.is_some_and(|f| f.is_main() == 1)
                && let Some(host) = browser.and_then(|b| b.host())
            {
                host.send_dev_tools_message(Some(CLEAR_BASE));
            }
        }
    }
}

wrap_client! {
    pub struct ShellClient {
        role: Role,
        life_span: LifeSpanHandler,
        display: DisplayHandler,
        requests: RequestHandler,
        load: Option<LoadHandler>,
        desk: Arc<Desk>,
        // The main window's page (#52): it renders off screen, and posts to plugin surfaces (ADR 0160).
        render: Option<RenderHandler>,
        relay: Option<Relay>,
    }

    impl Client {
        fn request_handler(&self) -> Option<RequestHandler> {
            Some(self.requests.clone())
        }

        fn render_handler(&self) -> Option<RenderHandler> {
            self.render.clone()
        }

        fn on_process_message_received(
            &self,
            browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            _source_process: ProcessId,
            message: Option<&mut ProcessMessage>,
        ) -> ::std::os::raw::c_int {
            let (Some(frame), Some(message)) = (frame, message) else { return 0 };
            let name = CefString::from(&message.name()).to_string();
            // The compositor's page asks for frames while it rests (#134); a window's never needs to.
            if name == WAKE {
                if let Some(browser) = browser {
                    crate::web_host::frame_asks::heard(browser, frame, message);
                }
                return 1;
            }
            let arg = |i| {
                message
                    .argument_list()
                    .map(|list| CefString::from(&list.string(i)).to_string())
                    .unwrap_or_default()
            };
            let text = arg(0);
            match (name.as_str(), &self.relay) {
                (CALL, _) => host::receive(&self.desk, self.role, frame.clone(), text),
                // What the runtime posted for a plugin surface, which it names: to its own browser.
                (POST, Some(relay)) if frame.is_main() == 1 => relay.down(&arg(1), text),
                _ => return 0,
            }
            1
        }

        fn life_span_handler(&self) -> Option<LifeSpanHandler> {
            Some(self.life_span.clone())
        }

        fn display_handler(&self) -> Option<DisplayHandler> {
            Some(self.display.clone())
        }

        fn load_handler(&self) -> Option<LoadHandler> {
            self.load.clone()
        }
    }
}

/// The client of the browser in the window of `role`: the palette, Eris and the banner (the main
/// window's page is `compositor_page`'s).
pub fn client(role: Role, pump: Pump, desk: Arc<Desk>) -> Client {
    let banner = (role == Role::Banner).then(|| Arc::clone(&desk.core));
    let load = (cfg!(target_os = "macos") && role == Role::Eris).then(ClearBase::new);
    ShellClient::new(
        role,
        ShellLifeSpan::new(role, pump, false),
        ShellDisplay::new(role),
        crate::guard::Requests::new(banner),
        load,
        desk,
        None,
        None,
    )
}

/// The client of the main window's page (#52): it renders off screen through `render`, and posts to
/// plugin surfaces through `relay` (ADR 0160). Files dragged in from the OS come through the
/// compositor's input (#56).
pub fn compositor_page(pump: Pump, desk: Arc<Desk>, render: RenderHandler, relay: Relay) -> Client {
    ShellClient::new(
        Role::Main,
        ShellLifeSpan::new(Role::Main, pump, true),
        ShellDisplay::new(Role::Main),
        crate::guard::Requests::new(None),
        None,
        desk,
        Some(render),
        Some(relay),
    )
}
