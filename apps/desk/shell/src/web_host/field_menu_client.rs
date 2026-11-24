//! An off-screen browser's client with the text field's menu (#156): every handler and message is
//! its own client's, and its context menus are the field menu's. A wrapper, so the clients that
//! make the pages' browsers (`client.rs`, `crate::client`) stay as they are.
//!
//! On macOS it also ends a key its page left alone. CEF offers such a key to the app's menu bar
//! itself (`[[NSApp mainMenu] performKeyEquivalent:]`), and asked that way AppKit matches a bare
//! key to an item whose key is the Globe key's: `e` opened Emoji & Symbols (🌐E) and `d` started
//! dictation (🌐D), on every such key typed in a page. The menu bar had its turn before the key
//! reached the window, so the key ends here.

use cef::*;

/// Whether a key its off-screen page left alone ends here, not in CEF's own offer of it to the
/// app's menu bar: on macOS, where that offer matches a bare key to a Globe-key item.
pub const fn ends_unhandled_keys() -> bool {
    cfg!(target_os = "macos")
}

wrap_keyboard_handler! {
    pub struct PageKeys;

    impl KeyboardHandler {
        fn on_key_event(
            &self,
            _browser: Option<&mut Browser>,
            _event: Option<&KeyEvent>,
            _os_event: crate::cef_input::OsEvent<'_>,
        ) -> ::std::os::raw::c_int {
            ::std::os::raw::c_int::from(ends_unhandled_keys())
        }
    }
}

wrap_client! {
    pub struct WithMenu {
        inner: Client,
        menu: ContextMenuHandler,
        keys: KeyboardHandler,
    }

    impl Client {
        fn context_menu_handler(&self) -> Option<ContextMenuHandler> {
            Some(self.menu.clone())
        }

        fn audio_handler(&self) -> Option<AudioHandler> {
            self.inner.audio_handler()
        }

        fn command_handler(&self) -> Option<CommandHandler> {
            self.inner.command_handler()
        }

        fn dialog_handler(&self) -> Option<DialogHandler> {
            self.inner.dialog_handler()
        }

        fn display_handler(&self) -> Option<DisplayHandler> {
            self.inner.display_handler()
        }

        fn download_handler(&self) -> Option<DownloadHandler> {
            self.inner.download_handler()
        }

        fn drag_handler(&self) -> Option<DragHandler> {
            self.inner.drag_handler()
        }

        fn find_handler(&self) -> Option<FindHandler> {
            self.inner.find_handler()
        }

        fn focus_handler(&self) -> Option<FocusHandler> {
            self.inner.focus_handler()
        }

        fn frame_handler(&self) -> Option<FrameHandler> {
            self.inner.frame_handler()
        }

        fn permission_handler(&self) -> Option<PermissionHandler> {
            self.inner.permission_handler()
        }

        fn jsdialog_handler(&self) -> Option<JsdialogHandler> {
            self.inner.jsdialog_handler()
        }

        fn keyboard_handler(&self) -> Option<KeyboardHandler> {
            if ends_unhandled_keys() {
                Some(self.keys.clone())
            } else {
                self.inner.keyboard_handler()
            }
        }

        fn life_span_handler(&self) -> Option<LifeSpanHandler> {
            self.inner.life_span_handler()
        }

        fn load_handler(&self) -> Option<LoadHandler> {
            self.inner.load_handler()
        }

        fn print_handler(&self) -> Option<PrintHandler> {
            self.inner.print_handler()
        }

        fn render_handler(&self) -> Option<RenderHandler> {
            self.inner.render_handler()
        }

        fn request_handler(&self) -> Option<RequestHandler> {
            self.inner.request_handler()
        }

        fn on_process_message_received(
            &self,
            browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            source_process: ProcessId,
            message: Option<&mut ProcessMessage>,
        ) -> ::std::os::raw::c_int {
            self.inner
                .on_process_message_received(browser, frame, source_process, message)
        }
    }
}
