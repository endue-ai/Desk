//! The agent programs on this computer (ADR 0110): Claude Code and Codex, found by their own data
//! folders and programs, their sessions read from the files they keep (`claude`, `codex`), copied
//! into the desk's own folder (`imports`) and asked for work through their non-interactive modes
//! (`run`). Finding an agent never starts it; nothing here writes outside the desk's folder.
//! `core_agents` serves this as agents.* on the bridge.

mod args;
mod claude;
mod codex;
mod discover;
mod imports;
mod lines;
mod output;
mod run;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use desk_bridge::{LocalAgentId, LocalAgentMessage, LocalAgentRole, LocalAgentSession};

pub(crate) use args::{args as run_args, is_value};
pub(crate) use discover::program_for;
pub(crate) use imports::Imports;
pub(crate) use run::{AskPlan, Runs, start as start_run, stop as stop_run};

/// The PATH a run's program gets: the folders programs are looked for in, the desk's PATH after.
pub(crate) fn run_path(agents: &LocalAgents) -> Option<String> {
    let dirs = discover::search_path(agents);
    std::env::join_paths(dirs)
        .ok()
        .and_then(|p| p.into_string().ok())
}

/// The longest text one message or run carries.
pub(crate) const TEXT_MAX: usize = 8000;
/// The most turns a transcript answers, and an import keeps.
pub(crate) const TURNS_MAX: usize = 1000;

/// Where the agent programs keep their files, where the desk keeps its copies, and where programs
/// are looked for. `new` fills it as this computer has it; tests set each field.
#[derive(Debug, Clone)]
pub struct LocalAgentsOptions {
    /// The person's home folder.
    pub home: PathBuf,
    /// Claude Code's data folder: `$CLAUDE_CONFIG_DIR`, else `~/.claude`.
    pub claude_home: PathBuf,
    /// Codex's data folder: `$CODEX_HOME`, else `~/.codex`.
    pub codex_home: PathBuf,
    /// The folder apps keep their data in (`~/Library/Application Support` on macOS), where the
    /// Claude desktop app keeps which sessions are archived. None reads no such metadata.
    pub app_data: Option<PathBuf>,
    /// Where the desk keeps imported sessions (`<data>/agents`). None keeps them in memory only.
    pub data: Option<PathBuf>,
    /// The PATH the desk was started with.
    pub path: Option<String>,
    /// More folders programs are looked for in, and put first on a run's PATH.
    pub extra_path: Vec<PathBuf>,
}

impl LocalAgentsOptions {
    /// The folders as this computer has them for `home`, with imports kept under `data`.
    pub fn new(home: &Path, data: Option<PathBuf>) -> Self {
        let env_dir = |name: &str| {
            std::env::var_os(name)
                .filter(|v| !v.is_empty())
                .map(PathBuf::from)
        };
        Self {
            home: home.to_path_buf(),
            claude_home: env_dir("CLAUDE_CONFIG_DIR").unwrap_or_else(|| home.join(".claude")),
            codex_home: env_dir("CODEX_HOME").unwrap_or_else(|| home.join(".codex")),
            app_data: app_data(home),
            data,
            path: std::env::var("PATH").ok(),
            extra_path: discover::install_dirs(home),
        }
    }
}

/// Where apps keep their data on this system.
fn app_data(home: &Path) -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        Some(home.join("Library").join("Application Support"))
    } else if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else {
        Some(
            std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".config")),
        )
    }
}

/// The agent programs, their sessions as last read, the desk's copies and the runs.
pub struct LocalAgents {
    pub(crate) options: LocalAgentsOptions,
    scans: Mutex<HashMap<PathBuf, Scanned>>,
    pub(crate) desktop: Mutex<claude::DesktopCache>,
    pub(crate) codex_index: Mutex<codex::Index>,
    pub(crate) imports: Mutex<Imports>,
    pub(crate) runs: Arc<Mutex<Runs>>,
}

/// One session file as it was read, kept while its size and modification time stay the same.
#[derive(Clone)]
pub(crate) struct Scanned {
    size: u64,
    modified: u64,
    pub(crate) session: LocalAgentSession,
}

/// A session and the file it lives in.
#[derive(Debug, Clone)]
pub(crate) struct Found {
    pub(crate) session: LocalAgentSession,
    pub(crate) path: PathBuf,
    /// Seconds since the epoch the file last changed.
    pub(crate) modified: u64,
}

impl LocalAgents {
    pub fn new(options: LocalAgentsOptions) -> Self {
        let imports = Imports::open(options.data.clone());
        Self {
            options,
            scans: Mutex::default(),
            desktop: Mutex::default(),
            codex_index: Mutex::default(),
            imports: Mutex::new(imports),
            runs: Arc::default(),
        }
    }

    /// What an agent's program is called, who makes it, and its data folder.
    pub(crate) fn home_of(&self, agent: LocalAgentId) -> &Path {
        match agent {
            LocalAgentId::Claude => &self.options.claude_home,
            LocalAgentId::Codex => &self.options.codex_home,
        }
    }

    /// The program's sessions on this computer, archived ones among them, the newest first.
    pub(crate) fn scan(&self, agent: LocalAgentId) -> Vec<Found> {
        let mut found = match agent {
            LocalAgentId::Claude => claude::scan(self),
            LocalAgentId::Codex => codex::scan(self),
        };
        let imports = crate::sync::lock(&self.imports);
        for f in &mut found {
            if let Some(at) = imports.imported_at(agent, &f.session.id) {
                f.session.imported = true;
                f.session.imported_at = Some(at);
            }
        }
        found.sort_by(|a, b| b.session.updated_at.cmp(&a.session.updated_at));
        found
    }

    /// The session file `path` as `read` summarises it, from the cache while it is unchanged.
    pub(crate) fn summary(
        &self,
        path: &Path,
        read: impl FnOnce(&Path, u64, u64) -> Option<LocalAgentSession>,
    ) -> Option<Found> {
        let meta = std::fs::metadata(path).ok()?;
        let size = meta.len();
        let modified = seconds(meta.modified().ok()?);
        let cached = crate::sync::lock(&self.scans).get(path).cloned();
        let session = match cached {
            Some(s) if s.size == size && s.modified == modified => s.session,
            _ => {
                let session = read(path, size, modified)?;
                let scanned = Scanned {
                    size,
                    modified,
                    session: session.clone(),
                };
                crate::sync::lock(&self.scans).insert(path.to_path_buf(), scanned);
                session
            }
        };
        Some(Found {
            session,
            path: path.to_path_buf(),
            modified,
        })
    }

    /// One session's turns from its file: the last `limit`, and whether earlier ones were left out.
    pub(crate) fn read_turns(
        &self,
        agent: LocalAgentId,
        path: &Path,
        limit: usize,
    ) -> Option<(Vec<LocalAgentMessage>, bool)> {
        let mut turns = Turns::new(limit);
        let read = match agent {
            LocalAgentId::Claude => claude::turns(path, &mut turns),
            LocalAgentId::Codex => codex::turns(path, &mut turns),
        };
        read.ok()?;
        Some(turns.finish())
    }
}

/// The last turns of a session as they are read, oldest first.
pub(crate) struct Turns {
    limit: usize,
    kept: std::collections::VecDeque<LocalAgentMessage>,
    dropped: bool,
}

impl Turns {
    pub(crate) fn new(limit: usize) -> Self {
        Self {
            limit: limit.max(1),
            kept: Default::default(),
            dropped: false,
        }
    }

    pub(crate) fn push(
        &mut self,
        role: LocalAgentRole,
        text: &str,
        name: Option<&str>,
        at: Option<&str>,
    ) {
        let (text, cut) = clip(text.trim(), TEXT_MAX);
        if text.is_empty() && role != LocalAgentRole::Tool {
            return;
        }
        if self.kept.len() == self.limit {
            self.kept.pop_front();
            self.dropped = true;
        }
        self.kept.push_back(LocalAgentMessage {
            role,
            text,
            name: name.map(|n| clip(n, 128).0),
            at: at.and_then(timestamp),
            cut: cut.then_some(true),
        });
    }

    pub(crate) fn finish(self) -> (Vec<LocalAgentMessage>, bool) {
        (self.kept.into(), self.dropped)
    }
}

/// `text` cut to at most `max` characters, and whether it was cut.
pub(crate) fn clip(text: &str, max: usize) -> (String, bool) {
    match text.char_indices().nth(max) {
        Some((at, _)) => (text[..at].to_owned(), true),
        None => (text.to_owned(), false),
    }
}

/// A title from the first line of what the person asked.
pub(crate) fn title_of(prompt: &str) -> String {
    let line = prompt
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or_default();
    let (mut title, cut) = clip(line, 80);
    if cut {
        title.push('…');
    }
    title
}

/// An RFC 3339 time as the bridge writes it (whole seconds, UTC), when `text` reads as one.
pub(crate) fn timestamp(text: &str) -> Option<String> {
    let secs = crate::time::parse_rfc3339(text)?;
    u64::try_from(secs).ok().map(crate::time::rfc3339)
}

pub(crate) fn seconds(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// Whether `id` is a session id the bridge carries (`LocalAgentSessionId`).
pub(crate) fn is_session_id(id: &str) -> bool {
    let mut chars = id.chars();
    let first = chars.next().is_some_and(|c| c.is_ascii_alphanumeric());
    first
        && id.len() <= 128
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'))
}

/// The bridge's name of an agent.
pub(crate) fn agent_name(agent: LocalAgentId) -> &'static str {
    match agent {
        LocalAgentId::Claude => "claude",
        LocalAgentId::Codex => "codex",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_is_cut_at_whole_characters() {
        assert_eq!(clip("héllo", 2), ("hé".to_owned(), true));
        assert_eq!(clip("hi", 2), ("hi".to_owned(), false));
        assert_eq!(title_of("\n  Fix the build\nand more"), "Fix the build");
        assert!(title_of(&"x".repeat(100)).ends_with('…'));
    }

    #[test]
    fn session_ids_are_values_a_program_may_see() {
        assert!(is_session_id("5b1c2d3e-0f1a-4b2c-9d3e-4f5a6b7c8d9e"));
        assert!(!is_session_id("-resume"));
        assert!(!is_session_id("a b"));
        assert!(!is_session_id(""));
    }

    #[test]
    fn turns_keep_the_last_ones_and_say_so() {
        let mut turns = Turns::new(2);
        for text in ["one", "two", "three"] {
            turns.push(
                LocalAgentRole::User,
                text,
                None,
                Some("2026-11-05T09:00:00.123Z"),
            );
        }
        turns.push(LocalAgentRole::Assistant, "   ", None, None);
        let (kept, dropped) = turns.finish();
        assert!(dropped);
        assert_eq!(
            kept.iter().map(|m| m.text.as_str()).collect::<Vec<_>>(),
            ["two", "three"]
        );
        assert_eq!(kept[0].at.as_deref(), Some("2026-11-05T09:00:00Z"));
    }
}
