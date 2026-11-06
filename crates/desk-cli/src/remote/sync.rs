//! `desk plugin sync` (ADR 0079): turn every installed plugin on or off as `~/.desk/plugins.lock` says,
//! through plugin.setEnabled only where the state differs. Plugins the lock does not name are left
//! alone; a version that differs is noted, not changed; a plugin the lock names that is not installed
//! is reported and makes the exit code 1 (installing it is the market's, later). One line each:
//! `disabled|enabled <id>`, `version <id> <locked> <installed>`, `missing <id>`, tab-separated.

use std::process::ExitCode;

use desk_bridge::PluginInfo;
use serde_json::json;

use super::{Problem, Session, out};

impl Session {
    pub(super) fn sync(&mut self) -> Result<ExitCode, Problem> {
        let (_, lock) = crate::lock::read().map_err(Problem::Request)?;
        let scope = json!({ "permission": "plugin:manage" });
        let listed = self.call("plugin.list", json!({ "scope": scope }))?;
        let listed = listed.result.map_err(|(code, message)| {
            Problem::Request(format!("plugin.list: {code}: {message}"))
        })?;
        let plugins: Vec<PluginInfo> = serde_json::from_value(listed["plugins"].clone())
            .map_err(|e| Problem::Request(format!("plugin.list answered {e}")))?;
        let plan = desk_core::lock::plan(&lock, &plugins);
        let mut failed = false;
        let turns = plan.disable.iter().map(|id| (id, false));
        for (id, enabled) in turns.chain(plan.enable.iter().map(|id| (id, true))) {
            let params = json!({ "plugin": id, "enabled": enabled, "scope": scope });
            match self.call("plugin.setEnabled", params)?.result {
                Ok(_) => out(&format!(
                    "{}\t{id}",
                    if enabled { "enabled" } else { "disabled" }
                )),
                Err((code, message)) => {
                    eprintln!("desk: {id}: {code}: {message}");
                    failed = true;
                }
            }
        }
        for (id, locked, installed) in &plan.versions {
            out(&format!("version\t{id}\t{locked}\t{installed}"));
        }
        for id in &plan.missing {
            out(&format!("missing\t{id}"));
        }
        let ok = !failed && plan.missing.is_empty();
        Ok(if ok {
            ExitCode::SUCCESS
        } else {
            ExitCode::from(1)
        })
    }
}
