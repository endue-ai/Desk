//! `desk undo` and `desk redo` (ADR 0077): the desk's undo stack, under the `cmd:invoke ["*"]` the
//! app grants `cli`. Prints what was undone or redone (`command`, `caller`, `at`), or that there
//! was nothing, and exits 0 either way.

use std::process::ExitCode;

use serde_json::json;

use crate::remote::{Problem, Session, text};

impl Session {
    pub(crate) fn undo(&mut self, redo: bool) -> Result<ExitCode, Problem> {
        let method = if redo { "cmd.redo" } else { "cmd.undo" };
        let scope = json!({ "permission": "cmd:invoke", "ids": ["*"] });
        let reply = self.call(method, json!({ "scope": scope }))?;
        Ok(self.report(reply, |result| {
            let entry = &result["undone"];
            if entry.is_null() {
                let what = if redo { "redo" } else { "undo" };
                return vec![format!("nothing to {what}")];
            }
            let (command, caller) = (text(entry, "command"), text(entry, "caller"));
            vec![format!("{command}\t{caller}\t{}", text(entry, "at"))]
        }))
    }
}
