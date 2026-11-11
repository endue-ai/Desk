//! `desk update` (ADR 0054): the desk's updater, one status line per answer.

use std::process::ExitCode;

use desk_bridge::BridgeEvent;
use serde_json::{Value, json};

use super::{Problem, Reply, Session, text};
use crate::args::UpdateStep;

impl Session {
    /// update.* (ADR 0054), one status line. `check` waits for the `update.changed` that ends the
    /// check, and exits 1 when it failed.
    pub(super) fn update(&mut self, step: UpdateStep) -> Result<ExitCode, Problem> {
        let scope = json!({ "permission": "update:manage" });
        let (method, params) = match step {
            UpdateStep::Status => ("update.status", json!({ "scope": scope })),
            UpdateStep::Check => ("update.check", json!({ "scope": scope })),
            UpdateStep::Download => ("update.download", json!({ "scope": scope })),
            UpdateStep::Apply => ("update.apply", json!({ "scope": scope })),
            UpdateStep::Channel(channel) => (
                "update.setChannel",
                json!({ "channel": channel, "scope": scope }),
            ),
        };
        let reply = self.call(method, params)?;
        let checking = matches!(step, UpdateStep::Check)
            && reply
                .result
                .as_ref()
                .is_ok_and(|s| s["state"] == "checking");
        if !checking {
            return Ok(self.report(reply, |status| vec![update_line(status)]));
        }
        loop {
            let (event, line) = self.client.next_event_line()?;
            let BridgeEvent::UpdateChanged(changed) = event else {
                continue;
            };
            let status = serde_json::to_value(&changed.data).unwrap_or_default();
            if status["state"] == "checking" {
                continue;
            }
            let result = if status["state"] == "failed" {
                Err(("failed".to_owned(), text(&status, "reason").to_owned()))
            } else {
                Ok(status)
            };
            return Ok(self.report(Reply { result, line }, |status| vec![update_line(status)]));
        }
    }
}

/// `state  running  channel  chosen [percent]`: `staged  0.1.0  stable  0.2.0`.
fn update_line(status: &Value) -> String {
    let chosen = status["release"]["version"].as_str().unwrap_or("-");
    let mut line = format!(
        "{}\t{}\t{}\t{chosen}",
        text(status, "state"),
        text(&status["current"], "version"),
        text(status, "channel")
    );
    if let (Some(received), Some(total)) = (status["received"].as_u64(), status["total"].as_u64())
        && total > 0
    {
        line.push_str(&format!("\t{}%", received * 100 / total));
    }
    line
}
