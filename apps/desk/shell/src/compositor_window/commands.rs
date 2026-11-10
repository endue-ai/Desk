//! The shell page's compositor commands (#52, #56, #81), the runtime's only (`desk_web::sender`):
//! `compositor_desk` (what only the page knows of the desk, `report.rs`), `compositor_keys` (the
//! keymap's entries, which the compositor resolves to decide before delivery whose a key is) and
//! `compositor_focus` (the surface whose stand-in has the page's focus), `compositor_grab` (a press
//! the page found starts a move, a resize or a pan, #80), `compositor_wm` (a window command:
//! maximize, snap, a step), `compositor_edit` (the runtime's edits of the window manager's state,
//! #83) and `compositor_snapshot` (what `desk.windows.list` answers); in development builds
//! `compositor_capture { path }` (the composed frame as a PNG), `compositor_stats` (what every surface
//! painted), `compositor_input { events, logical? }` (events fed to the window's own input entry,
//! `harness.rs`), `compositor_input_state` (where input goes) and `compositor_a11y` (the
//! accessibility tree the adapter has, and a screen reader's request, `a11y_check.rs`). They run on
//! the event loop's thread, where the compositor is.

use std::sync::mpsc;
use std::time::Duration;

use desk_wm::Told;
use desk_wm::interact::{Kind, Op};

use super::wm::Call;
use serde_json::Value;

use super::input::KeysReport;
use super::report::DeskReport;
use crate::host::Desk;

/// The number of the desk a call of the page's follows (`after`; 0: none).
fn after(args: &Value) -> u64 {
    args.get("after")
        .and_then(Value::as_u64)
        .unwrap_or_default()
}

/// The answer to `cmd` with `args`.
pub fn answer(desk: &Desk, cmd: &str, args: &Value) -> Result<Value, String> {
    match cmd {
        "compositor_desk" => {
            let report: DeskReport =
                serde_json::from_value(args.clone()).map_err(|why| format!("not a desk: {why}"))?;
            desk.pump.run(move |shell, _| {
                if let Some(compositor) = shell.compositor.as_mut() {
                    compositor.report(report);
                }
            });
            Ok(Value::Null)
        }
        "compositor_keys" => {
            let report: KeysReport = serde_json::from_value(args.clone())
                .map_err(|why| format!("not a keymap: {why}"))?;
            desk.pump.run(move |shell, _| {
                if let Some(compositor) = shell.compositor.as_mut() {
                    compositor.keys(report);
                }
            });
            Ok(Value::Null)
        }
        "compositor_focus" => {
            let surface = args
                .get("surface")
                .and_then(Value::as_str)
                .map(str::to_owned);
            desk.pump.run(move |shell, event_loop| {
                if let Some(compositor) = shell.compositor.as_mut() {
                    compositor.page_focus(event_loop, surface);
                }
            });
            Ok(Value::Null)
        }
        "compositor_grab" => {
            let kind: Kind =
                serde_json::from_value(args.get("gesture").cloned().unwrap_or_default())
                    .map_err(|why| format!("not a gesture: {why}"))?;
            let at = |k: &str| args.get(k).and_then(Value::as_f64).unwrap_or_default();
            let (x, y) = (at("x"), at("y"));
            let call = Call::Grab { kind, x, y };
            let after = after(args);
            desk.pump.run(move |shell, _| {
                if let Some(compositor) = shell.compositor.as_mut() {
                    compositor.page_call(call, after);
                }
            });
            Ok(Value::Null)
        }
        "compositor_wm" => {
            let op: Op = serde_json::from_value(args.get("op").cloned().unwrap_or_default())
                .map_err(|why| format!("not a window command: {why}"))?;
            let window = (args.get("window").and_then(Value::as_str)).map(str::to_owned);
            let call = Call::Command { op, window };
            let after = after(args);
            desk.pump.run(move |shell, _| {
                if let Some(compositor) = shell.compositor.as_mut() {
                    compositor.page_call(call, after);
                }
            });
            Ok(Value::Null)
        }
        "compositor_edit" => {
            let seq = args.get("seq").and_then(Value::as_u64).unwrap_or_default();
            // Read one by one in the window manager: one it cannot read answers null.
            let edits = (args.get("edits").and_then(Value::as_array))
                .ok_or("not the window manager's edits: no list")?
                .clone();
            desk.pump.run(move |shell, _| {
                if let Some(compositor) = shell.compositor.as_mut() {
                    compositor.page_edit(seq, edits);
                }
            });
            Ok(Value::Null)
        }
        "compositor_snapshot" => {
            let told: Told = serde_json::from_value(args.get("told").cloned().unwrap_or_default())
                .map_err(|why| format!("not a snapshot's frames: {why}"))?;
            let (answer, answered) = mpsc::channel();
            let call = Call::Snapshot { told, answer };
            let after = after(args);
            desk.pump.run(move |shell, _| {
                if let Some(compositor) = shell.compositor.as_mut() {
                    compositor.page_call(call, after);
                }
            });
            answered
                .recv_timeout(Duration::from_secs(10))
                .map_err(|_| "the window manager did not answer".to_owned())
        }
        "compositor_capture"
        | "compositor_stats"
        | "compositor_input"
        | "compositor_input_state"
        | "compositor_a11y"
            if cfg!(debug_assertions) =>
        {
            let (sent, answered) = mpsc::channel();
            let (cmd, args) = (cmd.to_owned(), args.clone());
            desk.pump.run(move |shell, event_loop| {
                let Some(c) = shell.compositor.as_mut() else {
                    let _ = sent.send(Err("the desk is not in compositor mode".to_owned()));
                    return;
                };
                let path = args.get("path").and_then(Value::as_str);
                let answer = match (cmd.as_str(), path) {
                    ("compositor_capture", Some(path)) => c.capture(path),
                    ("compositor_capture", None) => Err("a capture needs a path".to_owned()),
                    ("compositor_input", _) => {
                        let scale = c.window.scale_factor();
                        if let Some(follow) = args.get("osPointer").and_then(Value::as_bool) {
                            c.follow_os_pointer = follow;
                        }
                        super::harness::events(&args, scale).map(|events| {
                            let fed = events.len();
                            for event in events {
                                c.input(event_loop, event);
                            }
                            serde_json::json!({ "fed": fed })
                        })
                    }
                    ("compositor_input_state", _) => Ok(c.input_state()),
                    ("compositor_a11y", _) => c.a11y_check(event_loop, &args),
                    _ => Ok(c.stats()),
                };
                let _ = sent.send(answer);
            });
            answered
                .recv_timeout(Duration::from_secs(10))
                .map_err(|_| "the compositor did not answer".to_owned())?
        }
        other => Err(format!("the CEF shell has no command {other}")),
    }
}
