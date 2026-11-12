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
use desk_web::sender::{Role, System};

use crate::host::{self, Desk};
use crate::pump::{Pump, Wake};
use crate::renderer::{CALL, POST, WAKE};
use crate::web_host::relay::Relay;
use crate::web_host::{WebHost, window_pages};

wrap_life_span_handler! {
    pub struct ShellLifeSpan {
        role: Role,
        pump: Pump,
        windowless: bool,
        // The web host the desk's page opens its windows' pages into (ADR 0201).
        pages: Option<WebHost>,
    }

    impl LifeSpanHandler {
        // A popup the desk's page names `desk-window:<id>` is that window's page, off screen (ADR
        // 0201); any other opens only on a press, as Chromium's popup blocker had it.
        #[allow(clippy::too_many_arguments)]
        fn on_before_popup(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _popup_id: ::std::os::raw::c_int,
            _target_url: Option<&CefString>,
            target_frame_name: Option<&CefString>,
            _target_disposition: WindowOpenDisposition,
            user_gesture: ::std::os::raw::c_int,
            popup_features: Option<&PopupFeatures>,
            window_info: Option<&mut WindowInfo>,
            client: Option<&mut Option<Client>>,
            settings: Option<&mut BrowserSettings>,
            _extra_info: Option<&mut Option<DictionaryValue>>,
            _no_javascript_access: Option<&mut ::std::os::raw::c_int>,
        ) -> ::std::os::raw::c_int {
            let name = target_frame_name.map(|n| n.to_string()).unwrap_or_default();
            let (Some(host), Some(window)) = (&self.pages, window_pages::window_of(&name)) else {
                return i32::from(user_gesture == 0);
            };
            let (Some(info), Some(settings), Some(client)) = (window_info, settings, client) else {
                return 1;
            };
            let size = popup_features.map_or((1, 1), |f| (f.width.max(1) as u32, f.height.max(1) as u32));
            match host.window_page(window, size, info, settings) {
                Some(page) => {
                    *client = Some(page);
                    0
                }
                None => 1,
            }
        }

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
    // The main window's page renders off screen (#52), so its cursor and its hover titles go to
    // the compositor through the web host, as a plugin surface's do (`web_host/client.rs`, #156);
    // a window's browser shows its own.
    pub struct ShellDisplay {
        role: Role,
        host: Option<WebHost>,
    }

    impl DisplayHandler {
        fn on_cursor_change(
            &self,
            _browser: Option<&mut Browser>,
            _cursor: *mut u8,
            type_: CursorType,
            custom_cursor_info: Option<&CursorInfo>,
        ) -> ::std::os::raw::c_int {
            let Some(host) = &self.host else { return 0 };
            host.cursor(System::Desk.id(), type_, custom_cursor_info);
            1
        }

        fn on_tooltip(
            &self,
            _browser: Option<&mut Browser>,
            text: Option<&mut CefString>,
        ) -> ::std::os::raw::c_int {
            let Some(host) = &self.host else { return 0 };
            let text = text.map(|t| t.to_string()).unwrap_or_default();
            host.tooltip(System::Desk.id(), &text);
            1
        }

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
        ShellLifeSpan::new(role, pump, false, None),
        ShellDisplay::new(role, None),
        crate::guard::Requests::new(banner),
        load,
        desk,
        None,
        None,
    )
}

/// The client of the main window's page (#52): it renders off screen through `render`, posts to
/// plugin surfaces through `relay` (ADR 0160) and says its cursor and hover titles through `host`.
/// Files dragged in from the OS come through the compositor's input (#56).
pub fn compositor_page(
    pump: Pump,
    desk: Arc<Desk>,
    render: RenderHandler,
    relay: Relay,
    host: WebHost,
) -> Client {
    ShellClient::new(
        Role::Main,
        ShellLifeSpan::new(Role::Main, pump, true, Some(host.clone())),
        ShellDisplay::new(Role::Main, Some(host)),
        crate::guard::Requests::new(None),
        None,
        desk,
        Some(render),
        Some(relay),
    )
}
