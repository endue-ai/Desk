//! The client of an app window's browser (#234): an off-screen surface's (`web_host/client.rs`)
//! without what only an off-screen page needs. No render handler (the browser paints its own view),
//! no cursor or hover-title overrides (its view sets the cursor and draws the tooltip), no field
//! menu (the OS's own text services and the Edit menu reach its view), no frame asks (it paints on
//! the display's clock). It keeps the rest: no popups, the browser-process guard on every load,
//! its page's bridge calls as the plugin its URL names, its posts up the relay to the runtime's
//! page, its title for the OS window, the focus once its page loaded, and its close, which the
//! shell carries out (`DoClose`, as a `Pane`'s browser's).

// `wrap_client!` makes a constructor with one argument per field.
#![allow(clippy::too_many_arguments)]

use std::sync::Arc;

use cef::*;
use desk_web::sender::Role;

use crate::host::{self, Desk};
use crate::pump::Pump;
use crate::renderer::{CALL, POST, WAKE};
use crate::web_host::WebHost;

wrap_life_span_handler! {
    pub struct AppLifeSpan {
        host: WebHost,
        surface: String,
        pump: Pump,
    }

    impl LifeSpanHandler {
        // A plugin frame could open no popups (its sandbox has no allow-popups); nor can its page.
        #[allow(clippy::too_many_arguments)]
        fn on_before_popup(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _popup_id: ::std::os::raw::c_int,
            _target_url: Option<&CefString>,
            _target_frame_name: Option<&CefString>,
            _target_disposition: WindowOpenDisposition,
            _user_gesture: ::std::os::raw::c_int,
            _popup_features: Option<&PopupFeatures>,
            _window_info: Option<&mut WindowInfo>,
            _client: Option<&mut Option<Client>>,
            _settings: Option<&mut BrowserSettings>,
            _extra_info: Option<&mut Option<DictionaryValue>>,
            _no_javascript_access: Option<&mut ::std::os::raw::c_int>,
        ) -> ::std::os::raw::c_int {
            1
        }

        // CEF's own close would ask the winit window to close, which only reports it: the shell
        // lets go of the browser's view itself (`Pane::let_go`), as for its other windows.
        fn do_close(&self, browser: Option<&mut Browser>) -> ::std::os::raw::c_int {
            let id = browser.map_or(-1, |b| b.identifier());
            self.pump.run(move |shell, _| super::agreed(shell, id));
            1
        }

        fn on_before_close(&self, browser: Option<&mut Browser>) {
            let id = browser.map_or(-1, |b| b.identifier());
            self.host.app_closed(&self.surface, id);
            self.pump.run(move |shell, _| super::closed(shell, id));
        }
    }
}

wrap_display_handler! {
    pub struct AppDisplay {
        surface: String,
        pump: Pump,
    }

    impl DisplayHandler {
        fn on_title_change(&self, _browser: Option<&mut Browser>, title: Option<&CefString>) {
            let title = title.map(|t| t.to_string()).unwrap_or_default();
            let surface = self.surface.clone();
            self.pump.run(move |shell, _| super::titled(shell, &surface, &title));
        }

        fn on_console_message(
            &self,
            _browser: Option<&mut Browser>,
            _level: LogSeverity,
            message: Option<&CefString>,
            source: Option<&CefString>,
            line: ::std::os::raw::c_int,
        ) -> ::std::os::raw::c_int {
            if cfg!(debug_assertions) && let Some(message) = message {
                let source = source.map(|s| s.to_string()).unwrap_or_default();
                eprintln!("app window console ({}): {message} ({source}:{line})", self.surface);
            }
            0
        }
    }
}

wrap_load_handler! {
    // A browser told to take the focus before its page loaded leaves the page without it, so the
    // keys went nowhere until the window lost and got the focus again.
    pub struct AppLoad {
        surface: String,
        pump: Pump,
    }

    impl LoadHandler {
        fn on_load_end(
            &self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            _http_status_code: ::std::os::raw::c_int,
        ) {
            if frame.is_some_and(|f| f.is_main() == 1) {
                let surface = self.surface.clone();
                self.pump.run(move |shell, _| super::loaded(shell, &surface));
            }
        }
    }
}

wrap_request_handler! {
    pub struct AppRequests {
        surface: String,
    }

    impl RequestHandler {
        fn on_render_process_terminated(
            &self,
            _browser: Option<&mut Browser>,
            status: TerminationStatus,
            error_code: ::std::os::raw::c_int,
            _error_string: Option<&CefString>,
        ) {
            eprintln!(
                "endue Desk: the renderer of app window {} ended ({status:?}, {error_code})",
                self.surface
            );
        }

        fn resource_request_handler(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _request: Option<&mut Request>,
            _is_navigation: ::std::os::raw::c_int,
            _is_download: ::std::os::raw::c_int,
            _request_initiator: Option<&CefString>,
            _disable_default_handling: Option<&mut ::std::os::raw::c_int>,
        ) -> Option<ResourceRequestHandler> {
            Some(crate::guard::Guard::new())
        }
    }
}

wrap_client! {
    pub struct AppClient {
        display: DisplayHandler,
        life_span: LifeSpanHandler,
        load: LoadHandler,
        requests: RequestHandler,
        host: WebHost,
        surface: String,
        desk: Arc<Desk>,
    }

    impl Client {
        fn display_handler(&self) -> Option<DisplayHandler> {
            Some(self.display.clone())
        }

        fn life_span_handler(&self) -> Option<LifeSpanHandler> {
            Some(self.life_span.clone())
        }

        fn load_handler(&self) -> Option<LoadHandler> {
            Some(self.load.clone())
        }

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
            let name = CefString::from(&message.name()).to_string();
            let text = message
                .argument_list()
                .map(|list| CefString::from(&list.string(0)).to_string())
                .unwrap_or_default();
            match name.as_str() {
                // A windowed browser paints on the display's clock: it never waits for the desk's.
                WAKE => {}
                // Straight to the core, as the plugin the frame's URL names (never as another).
                CALL => host::receive(&self.desk, Role::Main, frame.clone(), text),
                // Only the surface's page itself speaks for it, to the runtime.
                POST if frame.is_main() == 1 => self.host.relay().up(&self.surface, text),
                _ => return 0,
            }
            1
        }
    }
}

/// The client of the browser in surface `surface`'s app window.
pub fn client(host: WebHost, surface: &str, pump: Pump, desk: Arc<Desk>) -> Client {
    let s = surface.to_owned();
    AppClient::new(
        AppDisplay::new(s.clone(), pump.clone()),
        AppLifeSpan::new(host.clone(), s.clone(), pump.clone()),
        AppLoad::new(s.clone(), pump),
        AppRequests::new(s.clone()),
        host,
        s,
        desk,
    )
}
