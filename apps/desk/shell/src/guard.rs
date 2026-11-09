//! The browser process's own check on every load (#42, `desk_web::guard`): a desk page that slips
//! past its CSP still reaches nothing but the desk's schemes. In the computer-use banner's browser it
//! also answers Stop and Resume, which come as a navigation the banner never makes (`computer.rs`).

use std::sync::Arc;

use cef::*;
use desk_core::Core;

use crate::computer::{Ask, asked};

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
    pub struct Requests {
        banner: Option<Arc<Core>>,
    }

    impl RequestHandler {
        fn on_before_browse(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            request: Option<&mut Request>,
            _user_gesture: ::std::os::raw::c_int,
            _is_redirect: ::std::os::raw::c_int,
        ) -> ::std::os::raw::c_int {
            let Some(core) = &self.banner else { return 0 };
            let url = request.map(|r| CefString::from(&r.url()).to_string()).unwrap_or_default();
            match asked(&url) {
                Some(Ask::Stop) => {
                    core.stop_computer();
                    1
                }
                Some(Ask::Resume) => {
                    core.resume_computer();
                    1
                }
                None => 0,
            }
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
            Some(Guard::new())
        }
    }
}
