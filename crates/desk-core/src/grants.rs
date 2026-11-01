//! The grant file (ADR 0029): the `always` grants, kept in one JSON file next to `plugins.json` and
//! rewritten whole on every change. `session` and `once` grants never reach it.
//!
//! ```json
//! { "version": 1, "nextId": 3, "grants": [{ "caller": "example.notes", "grant": { ... } }] }
//! ```
//!
//! `nextId` keeps the id counter, so grants made after a restart never reuse a loaded id. A missing
//! or unreadable file (not JSON, another version, another shape) starts empty.

use std::path::Path;

use desk_bridge::{CallerGrant, Grant, GrantDuration};
use serde::{Deserialize, Serialize};

pub const VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GrantFile {
    version: u32,
    next_id: u64,
    grants: Vec<CallerGrant>,
}

/// The `always` grants in `path` with the id counter, or nothing when it cannot be read.
pub fn load(path: &Path) -> (u64, Vec<(String, Grant)>) {
    let Some(file) = std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<GrantFile>(&text).ok())
        .filter(|file| file.version == VERSION)
    else {
        return (0, Vec::new());
    };
    let grants: Vec<(String, Grant)> = file
        .grants
        .into_iter()
        .filter(|held| held.grant.duration == GrantDuration::Always)
        .map(|held| (held.caller, held.grant))
        .collect();
    let highest = grants
        .iter()
        .filter_map(|(_, grant)| grant.grant_id.strip_prefix('g')?.parse::<u64>().ok())
        .max()
        .unwrap_or(0);
    (file.next_id.max(highest), grants)
}

/// Rewrite `path` with the `always` grants among `grants`. The write is atomic (a temp file renamed
/// over it); a failure leaves the grants in memory for this run.
pub fn save(path: &Path, next_id: u64, grants: &[(String, Grant)]) {
    let file = GrantFile {
        version: VERSION,
        next_id,
        grants: grants
            .iter()
            .filter(|(_, grant)| grant.duration == GrantDuration::Always)
            .map(|(caller, grant)| CallerGrant {
                caller: caller.clone(),
                grant: grant.clone(),
            })
            .collect(),
    };
    if let Ok(text) = serde_json::to_string_pretty(&file) {
        let _ = desk_sys::fs::write(path, text.as_bytes(), true);
    }
}
