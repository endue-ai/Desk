//! What a web view's page asks of the person, refused (#273, ADR 0216): script dialogs are
//! suppressed and a page that asks before it is left is left; it picks no file; it gets no
//! camera, microphone or screen, and nothing else a page prompts for (its place, notifications).
//! The desk draws no dialog for a page it does not know; a later version may ask the person.

use cef::*;

wrap_jsdialog_handler! {
    pub struct WebDialogs;

    impl JsdialogHandler {
        // No alert, confirm or prompt: the desk draws none for a page it does not know.
        fn on_jsdialog(
            &self,
            _browser: Option<&mut Browser>,
            _origin_url: Option<&CefString>,
            _dialog_type: JsdialogType,
            _message_text: Option<&CefString>,
            _default_prompt_text: Option<&CefString>,
            _callback: Option<&mut JsdialogCallback>,
            suppress_message: Option<&mut ::std::os::raw::c_int>,
        ) -> ::std::os::raw::c_int {
            if let Some(suppress) = suppress_message {
                *suppress = 1;
            }
            0
        }

        // A page that asks before it is left is left.
        fn on_before_unload_dialog(
            &self,
            _browser: Option<&mut Browser>,
            _message_text: Option<&CefString>,
            _is_reload: ::std::os::raw::c_int,
            callback: Option<&mut JsdialogCallback>,
        ) -> ::std::os::raw::c_int {
            if let Some(callback) = callback {
                callback.cont(1, None);
            }
            1
        }
    }
}

wrap_dialog_handler! {
    pub struct WebFiles;

    impl DialogHandler {
        // A page picks no file of the person's.
        fn on_file_dialog(
            &self,
            _browser: Option<&mut Browser>,
            _mode: FileDialogMode,
            _title: Option<&CefString>,
            _default_file_path: Option<&CefString>,
            _accept_filters: Option<&mut CefStringList>,
            _accept_extensions: Option<&mut CefStringList>,
            _accept_descriptions: Option<&mut CefStringList>,
            callback: Option<&mut FileDialogCallback>,
        ) -> ::std::os::raw::c_int {
            if let Some(callback) = callback {
                callback.cancel();
            }
            1
        }
    }
}

wrap_permission_handler! {
    pub struct WebPermissions;

    impl PermissionHandler {
        // No camera, microphone or screen for a page.
        fn on_request_media_access_permission(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _requesting_origin: Option<&CefString>,
            _requested_permissions: u32,
            callback: Option<&mut MediaAccessCallback>,
        ) -> ::std::os::raw::c_int {
            if let Some(callback) = callback {
                callback.cancel();
            }
            1
        }

        // Nor its place, notifications or anything else a page prompts for.
        fn on_show_permission_prompt(
            &self,
            _browser: Option<&mut Browser>,
            _prompt_id: u64,
            _requesting_origin: Option<&CefString>,
            _requested_permissions: u32,
            callback: Option<&mut PermissionPromptCallback>,
        ) -> ::std::os::raw::c_int {
            if let Some(callback) = callback {
                let deny = sys::cef_permission_request_result_t::CEF_PERMISSION_RESULT_DENY;
                callback.cont(PermissionRequestResult::from(deny));
            }
            1
        }
    }
}
