//! What a page's call answers, by its command: the names the Tauri shell's commands had, each
//! allowed to the windows its capability named (`desk_web::sender::Sender::may`). `bridge_call` goes
//! to the core as the caller the window and the frame are; the rest are the shell's own.

use desk_bridge::BridgeRequest;
use desk_web::sender::Sender;
use desk_web::wire::Call;
use serde_json::{Value, json};

use crate::eris_window::commands as eris;
use crate::host::Desk;

/// The answer to `call` from `sender`.
pub fn answer(desk: &Desk, sender: &Sender, call: Call) -> Result<Value, String> {
    if call.cmd == "bridge_call" {
        return bridge_call(desk, sender, &call.args);
    }
    if !sender.may(&call.cmd) {
        return Err(format!("this page may not use the command {}", call.cmd));
    }
    let Desk {
        start,
        crash,
        tracing,
        mcp,
        ..
    } = desk;
    let text = |name: &str| {
        call.args
            .get(name)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    match call.cmd.as_str() {
        "desk_ready" => Ok(json!(desk_boot::ready::ready(
            &text("status"),
            tracing,
            start,
            mcp
        ))),
        "desk_start" => Ok(start.info()),
        "desk_relaunch" => {
            // This desk's hold goes first, or the new one would hand its arguments here and quit.
            desk_boot::start::relaunch(|| {
                desk.instance
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .take();
            });
            Ok(Value::Null)
        }
        "desk_trace" => {
            let origin = call
                .args
                .get("origin")
                .and_then(Value::as_f64)
                .unwrap_or_default();
            let phases: Vec<desk_trace::RuntimePhase> =
                serde_json::from_value(call.args.get("phases").cloned().unwrap_or(Value::Null))
                    .map_err(|why| format!("not start-up phases: {why}"))?;
            tracing.runtime(origin, &phases);
            Ok(Value::Null)
        }
        // Main-window delivery only: OS-supplied paths, never a file opened or read.
        "take_open_files" => Ok(json!(desk.opened.take())),
        // The name the desk gives a file, so one file is one buffer (#162); nothing is read.
        "real_path" => Ok(json!(crate::real_path::real_path(
            &text("path"),
            &crate::paths::home_dir()
        ))),
        // The page's answer to a quit the person asked for (`quit.rs`, #163).
        "desk_quit" => {
            let answer = crate::quit::Answer::parse(&text("answer"))
                .ok_or_else(|| "desk_quit answers asking, quit or stay".to_owned())?;
            desk.pump
                .run(move |shell, event_loop| crate::quit::answered(shell, event_loop, answer));
            Ok(Value::Null)
        }
        "desk_crash" => Ok(json!(crash.record(&text("message"), &text("stack")))),
        "take_last_crash" => Ok(crash.take_last().unwrap_or(Value::Null)),
        "plugin:dialog|open" => crate::dialog::open(desk, &call.args),
        cmd if cmd.starts_with("palette_") => {
            let cmd = cmd.to_owned();
            desk.pump
                .run(move |shell, _| crate::palette::command(shell, &cmd));
            Ok(Value::Null)
        }
        cmd if cmd.starts_with(eris::PREFIX) => eris::answer(desk, cmd, &call.args),
        cmd if cmd.starts_with("compositor_") => {
            crate::compositor_window::commands::answer(desk, cmd, &call.args)
        }
        other => Err(format!("the CEF shell has no command {other}")),
    }
}

/// A bridge call, for the runtime itself or a plugin it hosts, the palette or Eris. The core checks
/// permissions; this names the caller and, for the Eris window, keeps her to her conversation.
fn bridge_call(desk: &Desk, sender: &Sender, args: &Value) -> Result<Value, String> {
    let named = args.get("caller").and_then(Value::as_str);
    let caller = sender
        .caller(named)
        .ok_or("this page may not use the bridge")?;
    let raw = args.get("request").cloned().unwrap_or(Value::Null);
    let method = raw
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    sender.may_ask(&method)?;
    let request: BridgeRequest =
        serde_json::from_value(raw).map_err(|why| format!("not a bridge request: {why}"))?;
    if cfg!(debug_assertions) && caller != desk_web::sender::RUNTIME {
        eprintln!("bridge: {caller} {method}");
    }
    let response = desk.core.handle(&caller, request);
    serde_json::to_value(response).map_err(|why| why.to_string())
}
