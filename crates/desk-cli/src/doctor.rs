//! `desk doctor --trace <file>`: the start-up trace a `DESK_TRACE=1` start wrote into the data
//! folder (`trace.json`, crates/desk-trace), summarized offline: every phase by start, the totals
//! (the ready line, the first interactive frame, each category's sum) and the five longest.
//! `--json` prints the same as one JSON document. Exit codes: 0 summarized, 1 the file cannot be
//! read or is no trace.

use std::io::{self, Write};
use std::path::Path;
use std::process::ExitCode;

pub fn trace(file: &Path, json: bool) -> ExitCode {
    let summary = std::fs::read_to_string(file)
        .map_err(|why| format!("cannot read {}: {why}", file.display()))
        .and_then(|text| {
            desk_trace::summarize(&text).map_err(|why| format!("{}: {why}", file.display()))
        });
    match summary {
        Ok(summary) => {
            let text = if json {
                format!("{}\n", summary.to_json())
            } else {
                summary.to_string()
            };
            let _ = io::stdout().lock().write_all(text.as_bytes());
            ExitCode::SUCCESS
        }
        Err(why) => {
            eprintln!("desk: {why}");
            ExitCode::from(1)
        }
    }
}
