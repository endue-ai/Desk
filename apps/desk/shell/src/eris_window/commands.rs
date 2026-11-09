//! The floating window's own commands (ADR 0121), named as the Tauri shell's inline plugin had them
//! (`plugin:eris-window|expand`, …) so `apps/desk/src/eris-window.ts` calls both shells alike. Only
//! the Eris window's page may call them (`desk_web::sender::Sender::may`); window work runs on the
//! event loop's thread.

use std::sync::Arc;
use std::sync::atomic::Ordering::Relaxed;

use desk_web::sender::Role;
use serde_json::Value;

use super::machine::Event;
use super::{apply, frame, lock};
use crate::host::Desk;

pub const PREFIX: &str = "plugin:eris-window|";

/// Answer `cmd` (`plugin:eris-window|<name>`) with `args`.
pub fn answer(desk: &Desk, cmd: &str, args: &Value) -> Result<Value, String> {
    let state = Arc::clone(desk.eris.get().ok_or("the Eris window is not set up")?);
    match cmd.strip_prefix(PREFIX).unwrap_or_default() {
        // The shortcut in force and whether the desk holds it.
        "state" => serde_json::to_value(lock(&state.shortcut).clone()).map_err(|e| e.to_string()),
        // Esc: she goes away until the desk is next in front or she is summoned.
        "dismiss" => {
            desk.pump.run(move |shell, _| {
                let effects = state.feed(Event::Dismiss);
                apply(shell, &state, effects);
            });
            Ok(Value::Null)
        }
        // Grow for her composer, or fold back to her figure.
        "expand" => {
            let open = args.get("open").and_then(Value::as_bool).unwrap_or(false);
            desk.pump
                .run(move |shell, _| frame::expand(shell, &state, open));
            Ok(Value::Null)
        }
        // Move the window with the pointer.
        "drag" => {
            state.dragged.store(true, Relaxed);
            desk.pump.run(|shell, _| {
                if let Some(pane) = shell.pane(Role::Eris)
                    && let Err(why) = pane.window.drag_window()
                {
                    eprintln!("Eris: the window did not follow the pointer ({why})");
                }
            });
            Ok(Value::Null)
        }
        // Bring the desk forward: an approval waits there.
        "reveal_main" => {
            desk.pump.run(|shell, _| crate::palette::reveal_main(shell));
            Ok(Value::Null)
        }
        other => Err(format!("the Eris window has no command {other}")),
    }
}
