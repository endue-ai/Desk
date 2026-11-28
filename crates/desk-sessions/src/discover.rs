//! Where the transcripts are: every session file under the programs' folders, with its size and
//! when it last changed. Symbolic links are never followed, so nothing outside those folders is read.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use desk_bridge::AgentProgram;

/// Codex keeps sessions by date; deeper folders are not its.
const CODEX_DEPTH: usize = 4;

/// One transcript on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transcript {
    pub agent: AgentProgram,
    pub path: PathBuf,
    pub size: u64,
    /// Milliseconds since the Unix epoch.
    pub modified: u64,
    /// The session a Claude subagent's transcript sits under.
    pub parent: Option<String>,
}

/// Every transcript under the Claude Code and Codex folders, in path order.
pub fn find(claude: &Path, codex: &Path) -> Vec<Transcript> {
    let mut found = Vec::new();
    for project in dirs(&claude.join("projects")) {
        for entry in entries(&project) {
            if entry.is_dir() {
                let parent = name(&entry);
                for sub in entries(&entry.join("subagents")) {
                    push(&mut found, AgentProgram::Claude, &sub, Some(parent.clone()));
                }
            } else {
                push(&mut found, AgentProgram::Claude, &entry, None);
            }
        }
    }
    for folder in ["sessions", "archived_sessions"] {
        walk(&codex.join(folder), CODEX_DEPTH, &mut found);
    }
    found.sort_by(|a, b| a.path.cmp(&b.path));
    found
}

fn walk(dir: &Path, depth: usize, found: &mut Vec<Transcript>) {
    for entry in entries(dir) {
        if entry.is_dir() {
            if depth > 0 {
                walk(&entry, depth - 1, found);
            }
        } else {
            push(found, AgentProgram::Codex, &entry, None);
        }
    }
}

/// A `.jsonl` (or, from Codex, `.jsonl.zst`) regular file, not a link, with what the OS says of it.
fn push(found: &mut Vec<Transcript>, agent: AgentProgram, path: &Path, parent: Option<String>) {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy())
        .unwrap_or_default();
    if !(name.ends_with(".jsonl") || name.ends_with(".jsonl.zst")) {
        return;
    }
    let Ok(meta) = fs::symlink_metadata(path) else {
        return;
    };
    if !meta.is_file() {
        return;
    }
    let modified = meta
        .modified()
        .ok()
        .and_then(|at| at.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64);
    found.push(Transcript {
        agent,
        path: path.to_path_buf(),
        size: meta.len(),
        modified,
        parent,
    });
}

/// The entries of `dir` that are files or folders, never links; nothing when it cannot be read.
fn entries(dir: &Path) -> Vec<PathBuf> {
    let Ok(read) = fs::read_dir(dir) else {
        return Vec::new();
    };
    read.filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_dir() || t.is_file()))
        .map(|entry| entry.path())
        .collect()
}

fn dirs(dir: &Path) -> Vec<PathBuf> {
    entries(dir).into_iter().filter(|p| p.is_dir()).collect()
}

fn name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}
