//! `desk market list` and `desk market install <id> [--accept]` (ADR 0107): what the markets offer,
//! one line each (`kind id version state verified|not-verified market`), and an install that names
//! the permissions it asks until `--accept` accepts them.

use std::process::ExitCode;

use serde_json::{Value, json};

use super::{Problem, Session, out, text};

impl Session {
    pub(super) fn market_list(&mut self) -> Result<ExitCode, Problem> {
        let scope = json!({ "permission": "plugin:manage" });
        let reply = self.call("market.list", json!({ "scope": scope }))?;
        let listed = match reply.result {
            Ok(listed) => listed,
            Err((code, message)) => return Ok(failed(&code, &message)),
        };
        if self.json {
            out(&listed.to_string());
            return Ok(ExitCode::SUCCESS);
        }
        for listing in listed["entries"].as_array().into_iter().flatten() {
            let entry = &listing["entry"];
            let verified = if listing["verified"] == true {
                "verified"
            } else {
                "not-verified"
            };
            out(&format!(
                "{}\t{}\t{}\t{}\t{verified}\t{}",
                text(entry, "kind"),
                text(entry, "id"),
                text(entry, "version"),
                text(listing, "state"),
                text(listing, "market"),
            ));
        }
        for problem in listed["problems"].as_array().into_iter().flatten() {
            eprintln!(
                "desk: {}: {}",
                text(problem, "market"),
                text(problem, "message")
            );
        }
        Ok(ExitCode::SUCCESS)
    }

    pub(super) fn market_install(&mut self, id: &str, accept: bool) -> Result<ExitCode, Problem> {
        let scope = json!({ "permission": "plugin:manage" });
        let reply = self.call("market.list", json!({ "scope": scope }))?;
        let listed = match reply.result {
            Ok(listed) => listed,
            Err((code, message)) => return Ok(failed(&code, &message)),
        };
        let entries = listed["entries"].as_array().cloned().unwrap_or_default();
        let Some(listing) = entries.iter().find(|l| l["entry"]["id"] == id) else {
            return Ok(failed(
                "not_found",
                &format!("no market in force lists {id}"),
            ));
        };
        let asked: Vec<Value> = listing["entry"]["permissions"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let added = listing["added"].as_array().cloned().unwrap_or_default();
        if !accept && !added.is_empty() {
            for permission in &added {
                let mut rest = permission.clone();
                let name = rest
                    .as_object_mut()
                    .and_then(|fields| fields.remove("permission"))
                    .unwrap_or_default();
                out(&format!(
                    "asks\t{}\t{rest}",
                    name.as_str().unwrap_or_default()
                ));
            }
            out(&format!(
                "desk market install {id} --accept installs it with these permissions"
            ));
            return Ok(ExitCode::from(1));
        }
        let params =
            json!({ "id": id, "market": listing["market"], "accept": asked, "scope": scope });
        let reply = self.call("plugin.install", params)?;
        match reply.result {
            Ok(installed) => {
                let plugin = &installed["plugin"];
                let version = plugin["manifest"]["version"].as_str().unwrap_or_default();
                out(&format!("installed\t{}\t{version}", text(plugin, "id")));
                Ok(ExitCode::SUCCESS)
            }
            Err((code, message)) => Ok(failed(&code, &message)),
        }
    }
}

fn failed(code: &str, message: &str) -> ExitCode {
    eprintln!("desk: {code}: {message}");
    ExitCode::from(1)
}
