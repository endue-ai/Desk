//! The island's own commands (ADR 0204), which only its page may call
//! (`desk_web::sender::Sender::may`): open and fold it, fit it to what it shows open, follow the
//! pointer, bring the desk forward.
//! Window work runs on the event loop's thread.

use std::sync::Arc;
use std::sync::atomic::Ordering::Relaxed;

use desk_web::sender::Role;
use serde_json::Value;

use super::frame;
use crate::host::Desk;

pub const PREFIX: &str = "island_";

/// Answer `cmd` (`island_<name>`) with `args`.
pub fn answer(desk: &Desk, cmd: &str, args: &Value) -> Result<Value, String> {
    let state = Arc::clone(desk.island.get().ok_or("the island is not set up")?);
    match cmd {
        // A press opens it or folds it; the page hears `island://open` with what it is now.
        "island_open" => {
            let open = args.get("open").and_then(Value::as_bool).unwrap_or(false);
            desk.pump
                .run(move |shell, _| frame::expand(shell, &state, open));
        }
        // The page's open content is this tall (CSS pixels): the window fits it.
        "island_fit" => {
            let height = args
                .get("height")
                .and_then(Value::as_f64)
                .unwrap_or(super::OPEN.1);
            desk.pump
                .run(move |shell, _| frame::fit(shell, &state, height));
        }
        // A press that moves: the window follows the pointer.
        "island_drag" => {
            state.dragged.store(true, Relaxed);
            desk.pump.run(|shell, _| {
                if let Some(pane) = shell.pane(Role::Island)
                    && let Err(why) = pane.window.drag_window()
                {
                    eprintln!("island: the window did not follow the pointer ({why})");
                }
            });
        }
        // Bring the desk forward: what waits is answered there until the island answers it.
        "island_reveal_main" => {
            desk.pump.run(|shell, _| crate::palette::reveal_main(shell));
        }
        other => return Err(format!("the island has no command {other}")),
    }
    Ok(Value::Null)
}
