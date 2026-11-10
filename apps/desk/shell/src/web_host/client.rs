//! The client of one off-screen plugin surface's browser: its render handler (`render.rs`); its
//! title, its cursor, its load (`ready`) and its renderer's death (`died`) for the host; no popups; the
//! browser-process guard on every load (`guard.rs`); its page's bridge calls, as the plugin its URL
//! names (`desk_web::sender`, #43); its postMessages for the relay; and a Tab past its page's end
//! (#123), for the relay too.

// `wrap_client!` makes a constructor with one argument per field.
#![allow(clippy::too_many_arguments)]

use std::sync::Arc;

use cef::*;
use desk_web::sender::Role;

use super::WebHost;
use crate::host::{self, Desk};
use crate::renderer::{CALL, POST, WAKE};

wrap_display_handler! {
    pub struct SurfaceDisplay {
        host: WebHost,
        surface: String,
    }

    impl DisplayHandler {
        fn on_title_change(&self, _browser: Option<&mut Browser>, title: Option<&CefString>) {
            let title = title.map(|t| t.to_string()).unwrap_or_default();
            self.host.titled(&self.surface, title);
        }

        // A windowless browser has no view to set a cursor on: the compositor sets the window's.
        fn on_cursor_change(
            &self,
            _browser: Option<&mut Browser>,
            _cursor: *mut u8,
            type_: CursorType,
            custom_cursor_info: Option<&CursorInfo>,
        ) -> ::std::os::raw::c_int {
            self.host.cursor(&self.surface, type_, custom_cursor_info);
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
            if cfg!(debug_assertions) && let Some(message) = message {
                let source = source.map(|s| s.to_string()).unwrap_or_default();
                eprintln!("surface console ({}): {message} ({source}:{line})", self.surface);
            }
            0
        }
    }
}

wrap_focus_handler! {
    // The page tabbed past its last control (`next`) or before its first (#123): the runtime page's
    // focus order goes on from the surface's place (`relay.rs`).
    pub struct SurfaceFocus {
        host: WebHost,
        surface: String,
    }

    impl FocusHandler {
        fn on_take_focus(&self, _browser: Option<&mut Browser>, next: ::std::os::raw::c_int) {
            self.host.relay().leave(&self.surface, next != 0);
        }
    }
}

wrap_life_span_handler! {
    pub struct SurfaceLifeSpan {
        host: WebHost,
        surface: String,
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

        // A new browser for the surface exports its tree if the surface does (#57).
        fn on_after_created(&self, browser: Option<&mut Browser>) {
            if let Some(browser) = browser {
                self.host.a11y_created(&self.surface, browser);
            }
        }

        fn on_before_close(&self, browser: Option<&mut Browser>) {
            if let Some(browser) = browser {
                self.host.closed(&self.surface, browser.identifier());
            }
        }
    }
}

wrap_load_handler! {
    pub struct SurfaceLoad {
        host: WebHost,
        surface: String,
    }

    impl LoadHandler {
        fn on_load_start(
            &self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            _transition_type: TransitionType,
        ) {
            if frame.is_some_and(|f| f.is_main() == 1) {
                self.host.loading(&self.surface);
            }
        }

        fn on_load_end(
            &self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            _http_status_code: ::std::os::raw::c_int,
        ) {
            if frame.is_some_and(|f| f.is_main() == 1) {
                self.host.loaded(&self.surface);
            }
        }
    }
}

wrap_request_handler! {
    pub struct SurfaceRequests {
        host: WebHost,
        surface: String,
    }

    impl RequestHandler {
        fn on_render_process_terminated(
            &self,
            browser: Option<&mut Browser>,
            status: TerminationStatus,
            error_code: ::std::os::raw::c_int,
            _error_string: Option<&CefString>,
        ) {
            let id = browser.map(|b| b.identifier()).unwrap_or(-1);
            self.host.died(&self.surface, id, status, error_code);
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
    pub struct SurfaceClient {
        render: RenderHandler,
        display: DisplayHandler,
        life_span: LifeSpanHandler,
        load: LoadHandler,
        requests: RequestHandler,
        focus: FocusHandler,
        host: WebHost,
        surface: String,
        desk: Option<Arc<Desk>>,
    }

    impl Client {
        fn render_handler(&self) -> Option<RenderHandler> {
            Some(self.render.clone())
        }

        fn focus_handler(&self) -> Option<FocusHandler> {
            Some(self.focus.clone())
        }

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
            browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            _source_process: ProcessId,
            message: Option<&mut ProcessMessage>,
        ) -> ::std::os::raw::c_int {
            let (Some(frame), Some(message)) = (frame, message) else { return 0 };
            let name = CefString::from(&message.name()).to_string();
            // Its page, or a frame in it, asks for frames while the surface rests (#134).
            if name == WAKE {
                if let Some(browser) = browser {
                    super::frames::asked(browser.identifier());
                }
                return 1;
            }
            let text = message
                .argument_list()
                .map(|list| CefString::from(&list.string(0)).to_string())
                .unwrap_or_default();
            match name.as_str() {
                // Straight to the core, as the plugin the frame's URL names (never as another).
                CALL => match &self.desk {
                    Some(desk) => host::receive(desk, Role::Main, frame.clone(), text),
                    None => return 0,
                },
                // Only the surface's page itself speaks for it; its drags go to the compositor's
                // broker (#56), the rest to the runtime.
                POST if frame.is_main() == 1 => {
                    if !self.host.drag_up(&self.surface, &text) {
                        self.host.relay().up(&self.surface, text);
                    }
                }
                _ => return 0,
            }
            1
        }
    }
}

/// The client of surface `surface`'s browser.
pub fn client(
    host: &WebHost,
    surface: &str,
    render: RenderHandler,
    desk: Option<Arc<Desk>>,
) -> Client {
    let (h, s) = (host.clone(), surface.to_owned());
    SurfaceClient::new(
        render,
        SurfaceDisplay::new(h.clone(), s.clone()),
        SurfaceLifeSpan::new(h.clone(), s.clone()),
        SurfaceLoad::new(h.clone(), s.clone()),
        SurfaceRequests::new(h.clone(), s.clone()),
        SurfaceFocus::new(h.clone(), s.clone()),
        h,
        s,
        desk,
    )
}
