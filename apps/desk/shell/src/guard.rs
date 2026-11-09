//! The browser process's own check on every load (#42, `desk_web::guard`): a desk page that slips
//! past its CSP still reaches nothing but the desk's schemes.

use cef::*;

wrap_resource_request_handler! {
    pub struct Guard;

    impl ResourceRequestHandler {
        fn on_before_resource_load(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            request: Option<&mut Request>,
            _callback: Option<&mut Callback>,
        ) -> ReturnValue {
            let url = request.map(|r| CefString::from(&r.url()).to_string()).unwrap_or_default();
            if desk_web::guard::allows(&url) {
                ReturnValue::CONTINUE
            } else {
                if cfg!(debug_assertions) {
                    eprintln!("endue Desk: refused a load of {url}");
                }
                ReturnValue::CANCEL
            }
        }
    }
}

wrap_request_handler! {
    pub struct Requests;

    impl RequestHandler {
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
            Some(Guard::new())
        }
    }
}
