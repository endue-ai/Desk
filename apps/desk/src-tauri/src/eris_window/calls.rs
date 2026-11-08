//! What the floating Eris asks of the core (ADR 0121): her settings, desk.eris.summon in the main
//! window, the notice that the shortcut is taken, and the check on the window's own calls.

use std::sync::atomic::Ordering::Relaxed;

use desk_bridge::{BridgeRequest, BridgeResponse};
use desk_core::Core;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use super::machine::{self, Float};
use super::{CALLER, ErisWindow, MAC, OWNER, SUMMON, lock, shortcut};

/// The notice that the shortcut is taken, once the runtime can show it, once per failure.
pub(super) fn notice(state: &ErisWindow) {
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

pub(super) fn talk_in_desk(app: &AppHandle, toggle: bool) {
    let Some(state) = app.try_state::<ErisWindow>() else {
        return;
    };
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

/// The floating window's calls go to the core as the desk, and only to talk to Eris.
pub fn check(request: &BridgeRequest) -> Result<(), String> {
    let value = serde_json::to_value(request).unwrap_or_default();
    let method = value["method"].as_str().unwrap_or_default();
    if machine::allowed(method) {
        Ok(())
    } else {
        Err(format!(
            "the floating Eris window talks to Eris only, not {method}"
        ))
    }
}

pub(super) fn call(core: &Core, caller: &str, request: Value) -> Result<Value, String> {
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

pub(super) fn mode(core: &Core) -> Float {
    Float::parse(setting(core, "float").as_deref())
}
