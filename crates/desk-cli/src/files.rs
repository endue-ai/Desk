//! `desk fs history` and `desk fs restore` (ADR 0076), and `desk log`. A path is the file's absolute
//! path, a `~/` path, or one relative to the working folder; the scope each call carries is that one
//! file, under the `fs:read`, `fs:write` and `log:read` the app grants `cli` (`desk_ipc::grants`).

use std::path::Path;
use std::process::ExitCode;

use serde_json::{Value, json};

use crate::args::FsStep;
use crate::remote::{Problem, Session, text};

impl Session {
    pub(crate) fn files(&mut self, step: FsStep) -> Result<ExitCode, Problem> {
        match step {
            FsStep::History { path, limit } => {
                let path = bridge_path(&path)?;
                let scope = json!({ "permission": "fs:read", "paths": [path] });
                let mut params = json!({ "path": path, "scope": scope });
                if let Some(limit) = limit {
                    params["limit"] = json!(limit);
                }
                let reply = self.call("fs.history", params)?;
                Ok(self.report(reply, |result| lines(&result["versions"], version_line)))
            }
            FsStep::Restore { path, version } => {
                let path = bridge_path(&path)?;
                let scope = json!({ "permission": "fs:write", "paths": [path] });
                let params = json!({ "path": path, "version": version, "scope": scope });
                self.done("fs.restore", params)
            }
        }
    }

    /// log.tail: the newest `count` entries (the desk's default without one), oldest first.
    pub(crate) fn log(&mut self, count: Option<u64>) -> Result<ExitCode, Problem> {
        let mut params = json!({ "scope": { "permission": "log:read" } });
        if let Some(count) = count {
            params["count"] = json!(count);
        }
        let reply = self.call("log.tail", params)?;
        Ok(self.report(reply, |result| lines(&result["entries"], entry_line)))
    }
}

fn lines(items: &Value, line: fn(&Value) -> String) -> Vec<String> {
    items.as_array().into_iter().flatten().map(line).collect()
}

/// `id`, `at`, `caller`, `size`, tab-separated.
fn version_line(version: &Value) -> String {
    let (id, at, caller) = (
        text(version, "id"),
        text(version, "at"),
        text(version, "caller"),
    );
    format!("{id}\t{at}\t{caller}\t{}", version["size"])
}

/// `at`, `level`, `channel`, `message`, tab-separated.
fn entry_line(entry: &Value) -> String {
    let (at, level, channel) = (
        text(entry, "at"),
        text(entry, "level"),
        text(entry, "channel"),
    );
    format!("{at}\t{level}\t{channel}\t{}", text(entry, "message"))
}

/// The path as the bridge takes it: `~/...` and absolute paths as they are, others joined to the
/// working folder.
fn bridge_path(path: &Path) -> Result<String, Problem> {
    let text = path
        .to_str()
        .ok_or_else(|| Problem::Request(format!("{} is not UTF-8", path.display())))?;
    if text == "~" || text.starts_with("~/") || path.is_absolute() {
        return Ok(text.to_owned());
    }
    let here = std::env::current_dir()?;
    let joined = here.join(path);
    joined
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| Problem::Request(format!("{} is not UTF-8", joined.display())))
}
