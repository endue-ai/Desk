//! An off-screen browser's client with the text field's menu (#156): every handler and message is
//! its own client's, and its context menus are the field menu's. A wrapper, so the clients that
//! make the pages' browsers (`client.rs`, `crate::client`) stay as they are.

use cef::*;

wrap_client! {
    pub struct WithMenu {
        inner: Client,
        menu: ContextMenuHandler,
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
            self.inner.keyboard_handler()
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
