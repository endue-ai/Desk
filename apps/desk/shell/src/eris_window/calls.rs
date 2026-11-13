//! What the shell asks of the core for Eris (ADR 0121): her shortcut's setting, desk.eris.summon in
//! the main window, and the notice that the shortcut is taken; and `call`, a core call as a fixed
//! caller, which the island uses too.

use std::sync::atomic::Ordering::Relaxed;

use desk_bridge::{BridgeRequest, BridgeResponse};
use desk_core::Core;
use serde_json::{Value, json};

use super::{CALLER, Eris, MAC, OWNER, SUMMON, lock, shortcut};

/// The notice that the shortcut is taken, once the runtime can show it, once per failure.
pub(super) fn notice(state: &Eris) {
    let held = lock(&state.shortcut).clone();
    let Some(why) = held.problem else {
        return;
    };
    if !state.ready.load(Relaxed) || state.noticed.swap(true, Relaxed) {
        return;
    }
    let (title, body) = shortcut::taken(&held.shortcut, MAC, &why);
    let request = json!({
        "id": 0,
        "method": "ui.notify",
        "params": { "title": title, "body": body, "level": "warning",
                    "scope": { "permission": "ui:notify" } },
    });
    if let Err(why) = call(&state.core, CALLER, request) {
        eprintln!("Eris: the notice was not shown ({why})");
    }
}

/// Run desk.eris.summon in the main window: open her composer there, or close it with `toggle`.
pub(super) fn talk_in_desk(state: &Eris, toggle: bool) {
    let request = json!({
        "id": 0,
        "method": "cmd.invoke",
        "params": { "id": SUMMON, "args": { "toggle": toggle },
                    "scope": { "permission": "cmd:invoke", "ids": [SUMMON] } },
    });
    if let Err(why) = call(&state.core, CALLER, request) {
        eprintln!("Eris: {SUMMON} did not run ({why})");
    }
}

pub(crate) fn call(core: &Core, caller: &str, request: Value) -> Result<Value, String> {
    let request: BridgeRequest = serde_json::from_value(request).map_err(|e| e.to_string())?;
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(answer) => Ok(answer.result),
        BridgeResponse::BridgeFailure(failed) => Err(failed.error.message),
    }
}

pub(super) fn setting(core: &Core, key: &str) -> Option<String> {
    let request = json!({ "id": 0, "method": "settings.get", "params": { "key": key } });
    let value = call(core, OWNER, request).ok()?;
    value.get("value")?.as_str().map(str::to_owned)
}
