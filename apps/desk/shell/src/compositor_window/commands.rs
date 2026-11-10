//! The shell page's compositor commands (#52), the runtime's only (`desk_web::sender`):
//! `compositor_layout` (where its plugin frames are, `layout.rs`), and in development builds
//! `compositor_capture { path }` (the composed frame as a PNG) and `compositor_stats` (what every
//! surface painted). They run on the event loop's thread, where the compositor is.

use std::sync::mpsc;
use std::time::Duration;

use serde_json::Value;

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
        "compositor_capture" | "compositor_stats" if cfg!(debug_assertions) => {
            let (sent, answered) = mpsc::channel();
            let (cmd, path) = (
                cmd.to_owned(),
                args.get("path").and_then(Value::as_str).map(str::to_owned),
            );
            desk.pump.run(move |shell, _| {
                let answer = match (shell.compositor.as_mut(), cmd.as_str(), path) {
                    (None, _, _) => Err("the desk is not in compositor mode".to_owned()),
                    (Some(c), "compositor_capture", Some(path)) => c.capture(&path),
                    (Some(_), "compositor_capture", None) => {
                        Err("a capture needs a path".to_owned())
                    }
                    (Some(c), _, _) => Ok(c.stats()),
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
