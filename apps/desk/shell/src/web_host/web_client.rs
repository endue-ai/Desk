//! The client of a web view's browser (#273, ADR 0216): a remote page's, so it is none of the
//! desk's. It answers no process message (no bridge call, no post, no ask for frames); every load
//! passes `web_rules::loads`; its own page goes only where the core allows (`web_may_visit`), and
//! a link that asks for a new window or tab loads in the view; what a page asks of the person is
//! refused (`web_refusals.rs`), and with no download handler nothing is downloaded. Its address, title and load
//! go to the view's caller (`web_state`); its cursor and hover title to the compositor, as a
//! plugin surface's do.

// `wrap_client!` makes a constructor with one argument per field.
#![allow(clippy::too_many_arguments)]

use cef::*;
use desk_core::WebState;

use super::web_rules::{BLANK, address, failed_page, host_of, loads, shown_address};
use super::{WebHost, web_refusals};

/// Chromium's code for a load the page or the person stopped: no failure to show.
const ABORTED: i32 = -3;

fn text(value: Option<&CefString>) -> String {
    value.map(|t| t.to_string()).unwrap_or_default()
}

wrap_display_handler! {
    pub struct WebDisplay {
        host: WebHost,
        surface: String,
    }

    impl DisplayHandler {
        fn on_address_change(
            &self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            url: Option<&CefString>,
        ) {
            if frame.is_some_and(|f| f.is_main() == 1)
                && let Some(url) = shown_address(&text(url))
            {
                self.host.web_state(&self.surface, |state| state.url = url.to_owned());
            }
        }

        fn on_title_change(&self, _browser: Option<&mut Browser>, title: Option<&CefString>) {
            let title: String = text(title).chars().take(1024).collect();
            self.host.web_state(&self.surface, |state| state.title = title);
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

        fn on_tooltip(
            &self,
            _browser: Option<&mut Browser>,
            text: Option<&mut CefString>,
        ) -> ::std::os::raw::c_int {
            let text = text.map(|t| t.to_string()).unwrap_or_default();
            self.host.tooltip(&self.surface, &text);
            1
        }
    }
}

wrap_life_span_handler! {
    pub struct WebLifeSpan {
        host: WebHost,
        surface: String,
    }

    impl LifeSpanHandler {
        // A view opens no window: what a press asked a new one for loads in the view.
        #[allow(clippy::too_many_arguments)]
        fn on_before_popup(
            &self,
            browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _popup_id: ::std::os::raw::c_int,
            target_url: Option<&CefString>,
            _target_frame_name: Option<&CefString>,
            _target_disposition: WindowOpenDisposition,
            user_gesture: ::std::os::raw::c_int,
            _popup_features: Option<&PopupFeatures>,
            _window_info: Option<&mut WindowInfo>,
            _client: Option<&mut Option<Client>>,
            _settings: Option<&mut BrowserSettings>,
            _extra_info: Option<&mut Option<DictionaryValue>>,
            _no_javascript_access: Option<&mut ::std::os::raw::c_int>,
        ) -> ::std::os::raw::c_int {
            if user_gesture != 0 {
                self.host.web_follow(&self.surface, browser, &text(target_url));
            }
            1
        }

        fn on_before_close(&self, browser: Option<&mut Browser>) {
            if let Some(browser) = browser {
                self.host.web_closed(&self.surface, browser.identifier());
            }
        }
    }
}

wrap_load_handler! {
    pub struct WebLoad {
        host: WebHost,
        surface: String,
    }

    impl LoadHandler {
        fn on_loading_state_change(
            &self,
            _browser: Option<&mut Browser>,
            is_loading: ::std::os::raw::c_int,
            can_go_back: ::std::os::raw::c_int,
            can_go_forward: ::std::os::raw::c_int,
        ) {
            self.host.web_state(&self.surface, |state| {
                state.loading = is_loading != 0;
                state.can_go_back = can_go_back != 0;
                state.can_go_forward = can_go_forward != 0;
            });
        }

        // Frames keep coming while a page loads, as for a plugin surface (`clock.rs`).
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

        // A page that did not load says so where it would be; its address stays the one asked.
        fn on_load_error(
            &self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            error_code: Errorcode,
            error_text: Option<&CefString>,
            failed_url: Option<&CefString>,
        ) {
            let Some(frame) = frame.filter(|f| f.is_main() == 1) else {
                return;
            };
            let url = text(failed_url);
            if *error_code.as_ref() as i32 == ABORTED || !address(&url) {
                return;
            }
            let page = failed_page(&url, &text(error_text));
            frame.load_url(Some(&page.as_str().into()));
        }
    }
}

wrap_resource_request_handler! {
    pub struct WebLoads;

    impl ResourceRequestHandler {
        fn on_before_resource_load(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            request: Option<&mut Request>,
            _callback: Option<&mut Callback>,
        ) -> ReturnValue {
            let url = request.map(|r| CefString::from(&r.url()).to_string()).unwrap_or_default();
            if loads(&url) {
                ReturnValue::CONTINUE
            } else {
                if cfg!(debug_assertions) {
                    eprintln!("endue Desk: a web view was refused a load of {url}");
                }
                ReturnValue::CANCEL
            }
        }
    }
}

wrap_request_handler! {
    pub struct WebRequests {
        host: WebHost,
        surface: String,
    }

    impl RequestHandler {
        // The view's own page goes only where its caller's grant covers; a frame in it goes
        // wherever the web lets it.
        fn on_before_browse(
            &self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            request: Option<&mut Request>,
            _user_gesture: ::std::os::raw::c_int,
            _is_redirect: ::std::os::raw::c_int,
        ) -> ::std::os::raw::c_int {
            if frame.is_none_or(|f| f.is_main() != 1) {
                return 0;
            }
            let url = request.map(|r| CefString::from(&r.url()).to_string()).unwrap_or_default();
            // The view's own page for a load that failed (`on_load_error`).
            if url.starts_with("data:text/html;charset=utf-8,") {
                return 0;
            }
            i32::from(!self.host.web_may_visit(&self.surface, &url))
        }

        // A link opened as a new tab (a middle press, a modifier): in the view.
        fn on_open_urlfrom_tab(
            &self,
            browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            target_url: Option<&CefString>,
            _target_disposition: WindowOpenDisposition,
            user_gesture: ::std::os::raw::c_int,
        ) -> ::std::os::raw::c_int {
            if user_gesture != 0 {
                self.host.web_follow(&self.surface, browser, &text(target_url));
            }
            1
        }

        // Its renderer ended: the page loads again, once the person asks (the toolbar's reload).
        fn on_render_process_terminated(
            &self,
            _browser: Option<&mut Browser>,
            _status: TerminationStatus,
            _error_code: ::std::os::raw::c_int,
            _error_string: Option<&CefString>,
        ) {
            eprintln!("endue Desk: the renderer of {} stopped", self.surface);
            self.host.web_state(&self.surface, |state| {
                state.loading = false;
                state.title = "This page stopped".to_owned();
            });
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
            Some(WebLoads::new())
        }
    }
}

wrap_client! {
    pub struct WebClient {
        render: RenderHandler,
        display: DisplayHandler,
        life_span: LifeSpanHandler,
        load: LoadHandler,
        requests: RequestHandler,
        dialogs: JsdialogHandler,
        files: DialogHandler,
        permissions: PermissionHandler,
    }

    impl Client {
        fn render_handler(&self) -> Option<RenderHandler> {
            Some(self.render.clone())
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

        fn jsdialog_handler(&self) -> Option<JsdialogHandler> {
            Some(self.dialogs.clone())
        }

        fn dialog_handler(&self) -> Option<DialogHandler> {
            Some(self.files.clone())
        }

        fn permission_handler(&self) -> Option<PermissionHandler> {
            Some(self.permissions.clone())
        }

        // Whatever a remote page's renderer sends, the desk hears none of it.
        fn on_process_message_received(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _source_process: ProcessId,
            _message: Option<&mut ProcessMessage>,
        ) -> ::std::os::raw::c_int {
            0
        }
    }
}

impl WebHost {
    /// The page of view surface `surface` changed: its caller hears the view's state.
    pub(super) fn web_state(&self, surface: &str, change: impl FnOnce(&mut WebState)) {
        let Some(host) = host_of(surface) else {
            return;
        };
        let told = {
            let mut inner = self.inner();
            inner.web.by_host.get_mut(host).map(|view| {
                change(&mut view.state);
                let state = view.state.clone();
                // An address the view refused is said once.
                view.state.refused = None;
                (view.id.clone(), state)
            })
        };
        if let (Some((view, state)), Some(desk)) = (told, &self.desk) {
            desk.core.web_changed(&view, state);
        }
    }

    /// Whether the page of view surface `surface` may go to `url` by itself: the core says,
    /// from its caller's grants. An address refused is told to the caller.
    pub(super) fn web_may_visit(&self, surface: &str, url: &str) -> bool {
        if url == BLANK {
            return true;
        }
        let view = host_of(surface)
            .and_then(|host| self.inner().web.by_host.get(host).map(|v| v.id.clone()));
        let allowed = (view.zip(self.desk.as_ref()))
            .is_some_and(|(view, desk)| desk.core.web_allows(&view, url));
        if !allowed {
            self.web_state(surface, |state| state.refused = Some(url.to_owned()));
        }
        allowed
    }

    /// The browser of view surface `surface` closed.
    pub(super) fn web_closed(&self, surface: &str, browser: i32) {
        let mut inner = self.inner();
        let its = (inner.records.get(surface))
            .and_then(|r| r.browser.as_ref())
            .is_some_and(|b| b.identifier() == browser);
        if its {
            inner.records.remove(surface);
        }
    }

    /// A press in view surface `surface` asked for `url` in a new window or tab: the view's
    /// own page goes there, if it may.
    fn web_follow(&self, surface: &str, browser: Option<&mut Browser>, url: &str) {
        if !address(url) || !self.web_may_visit(surface, url) {
            return;
        }
        if let Some(frame) = browser.and_then(|b| b.main_frame()) {
            frame.load_url(Some(&url.into()));
        }
    }
}

/// The client of view surface `surface`'s browser.
pub fn client(host: &WebHost, surface: &str, render: RenderHandler) -> Client {
    let (h, s) = (host.clone(), surface.to_owned());
    WebClient::new(
        render,
        WebDisplay::new(h.clone(), s.clone()),
        WebLifeSpan::new(h.clone(), s.clone()),
        WebLoad::new(h.clone(), s.clone()),
        WebRequests::new(h, s),
        web_refusals::WebDialogs::new(),
        web_refusals::WebFiles::new(),
        web_refusals::WebPermissions::new(),
    )
}
