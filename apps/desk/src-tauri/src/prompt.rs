//! The trust UI: permission prompts as native dialogs. Web content cannot draw or fake one, and the
//! text comes from the core (who asks, what it allows), with the caller's reason quoted.

use desk_core::{Prompt, Prompter, RUNTIME_CALLER};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};

const ALLOW: &str = "Allow";
const DENY: &str = "Don't Allow";

pub struct NativePrompter {
    app: AppHandle,
}

impl NativePrompter {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl Prompter for NativePrompter {
    /// Blocks until the person answers. Called from bridge calls, which never run on the main
    /// thread; the dialog itself is shown there by the dialog plugin.
    fn ask(&self, prompt: &Prompt) -> bool {
        let mut dialog = self
            .app
            .dialog()
            .message(message(prompt))
            .title("Permission request")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                ALLOW.to_owned(),
                DENY.to_owned(),
            ));
        let focused = self
            .app
            .webview_windows()
            .into_values()
            .find(|window| window.is_focused().unwrap_or(false));
        if let Some(window) = focused {
            dialog = dialog.parent(&window);
        }
        // Only the Allow button grants: closing the dialog or pressing Escape refuses.
        matches!(dialog.blocking_show_with_result(), MessageDialogResult::Custom(label) if label == ALLOW)
    }
}

fn message(prompt: &Prompt) -> String {
    let who = if prompt.caller == RUNTIME_CALLER {
        prompt.name.clone()
    } else {
        format!("{} ({})", prompt.name, prompt.caller)
    };
    let mut text = format!("{who} wants to {}.", prompt.summary);
    if !prompt.reason.is_empty() {
        text.push_str(&format!("\n\nIt says: “{}”", prompt.reason));
    }
    text
}
