//! The shell page's compositor commands (#52, #56), the runtime's only (`desk_web::sender`):
//! `compositor_layout` (where its plugin frames are, `layout.rs`), `compositor_keys` (the keymap's
//! entries, which the compositor resolves to decide before delivery whose a key is) and
//! `compositor_focus` (the surface whose stand-in has the page's focus); in development builds
//! `compositor_capture { path }` (the composed frame as a PNG), `compositor_stats` (what every surface
//! painted), `compositor_input { events, logical? }` (events fed to the window's own input entry,
//! `harness.rs`) and `compositor_input_state` (where input goes). They run on the event loop's
//! thread, where the compositor is.

use std::sync::mpsc;
use std::time::Duration;

use serde_json::Value;

use super::input::KeysReport;
use super::layout::Report;
use crate::host::Desk;

/// The answer to `cmd` with `args`.
pub fn answer(desk: &Desk, cmd: &str, args: &Value) -> Result<Value, String> {
    match cmd {
        "compositor_layout" => {
            let report: Report = serde_json::from_value(args.clone())
                .map_err(|why| format!("not a layout: {why}"))?;
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
        "compositor_capture"
        | "compositor_stats"
        | "compositor_input"
        | "compositor_input_state"
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
