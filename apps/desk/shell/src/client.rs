//! The browsers' client, one per window: it answers the pages' bridge calls (`host`) knowing which
//! window the browser is for (`Role`, which no page can change), tells the event loop when the
//! browser closed and, in development builds, prints the page's console to the terminal (CSP reports
//! land there too). The main window's also hears files dragged in from the OS (`drops.rs`); the
//! Eris window's clears the page's base colour so she stands on nothing (macOS, ADR 0121).

use std::sync::Arc;

use cef::*;
use desk_web::sender::Role;

use crate::host::{self, Desk};
use crate::pump::{Pump, Wake};
use crate::renderer::CALL;

wrap_life_span_handler! {
    pub struct ShellLifeSpan {
        role: Role,
        pump: Pump,
    }

    impl LifeSpanHandler {
        // CEF's own close would ask the browser's top-level window to close (`performClose:`,
        // `WM_CLOSE`, `delete_event`), and a winit window only reports that: the main one would
        // merely hide, and no browser would ever finish closing. The shell drops the window itself.
        fn do_close(&self, _browser: Option<&mut Browser>) -> ::std::os::raw::c_int {
            self.pump.wake(Wake::Closing(self.role));
            1
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
        drag: Option<DragHandler>,
        load: Option<LoadHandler>,
        desk: Arc<Desk>,
    }

    impl Client {
        fn request_handler(&self) -> Option<RequestHandler> {
            Some(self.requests.clone())
        }

        fn on_process_message_received(
            &self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            _source_process: ProcessId,
            message: Option<&mut ProcessMessage>,
        ) -> ::std::os::raw::c_int {
            let (Some(frame), Some(message)) = (frame, message) else { return 0 };
            if CefString::from(&message.name()).to_string() != CALL {
                return 0;
            }
            let text = message
                .argument_list()
                .map(|list| CefString::from(&list.string(0)).to_string())
                .unwrap_or_default();
            host::receive(&self.desk, self.role, frame.clone(), text);
            1
        }

        fn life_span_handler(&self) -> Option<LifeSpanHandler> {
            Some(self.life_span.clone())
        }

        fn display_handler(&self) -> Option<DisplayHandler> {
            Some(self.display.clone())
        }

        fn drag_handler(&self) -> Option<DragHandler> {
            self.drag.clone()
        }

        fn load_handler(&self) -> Option<LoadHandler> {
            self.load.clone()
        }
    }
}

/// The client of the browser in the window of `role`.
pub fn client(role: Role, pump: Pump, desk: Arc<Desk>) -> Client {
    let banner = (role == Role::Banner).then(|| Arc::clone(&desk.core));
    let drag = (role == Role::Main).then(|| crate::drops::Drops::new(desk.pages.clone()));
    let load = (cfg!(target_os = "macos") && role == Role::Eris).then(ClearBase::new);
    ShellClient::new(
        role,
        ShellLifeSpan::new(role, pump),
        ShellDisplay::new(role),
        crate::guard::Requests::new(banner),
        drag,
        load,
        desk,
    )
}
