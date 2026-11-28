//! The built-in connector `desk.agent-sessions` (ADR 0403): the session transcripts Claude Code and
//! Codex keep on this computer, read by desk-sessions, as `record` items of
//! `specs/item/v0/agent-session.schema.json`. One instance, `default`, no settings; connecting it is
//! the person's consent, and the folders it reads are fixed in code, read-only. What the last sync
//! read is kept in `agent-sessions.json` in the data folder, so a sync reads only what changed.

use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use desk_bridge::ItemSource;
use desk_sessions::{CONNECTOR, INSTANCE, Roots, Seen};

use crate::handler::Core;

/// The connector's id.
pub(crate) const SESSIONS: &str = CONNECTOR;
/// Between syncs: transcripts grow while people work.
pub(crate) const SESSIONS_INTERVAL: Duration = Duration::from_secs(300);
/// Items written to the index at once.
const BATCH: usize = 200;

/// Where the transcripts are and where what was read is kept.
pub(crate) struct AgentSessions {
    roots: Roots,
    seen_file: PathBuf,
}

impl Core {
    /// Read the sessions of the agent programs the core finds (ADR 0110), in the same folders
    /// (`CLAUDE_CONFIG_DIR` and `CODEX_HOME` included), keeping what was read in `seen_file`. Call it
    /// after `with_local_agents`; without local agents there is no such connector. This makes the
    /// built-in connector `desk.agent-sessions`; nothing is read until the person connects it.
    pub fn with_agent_sessions(self, seen_file: PathBuf) -> Self {
        let roots = self.local_agents.as_ref().map(|agents| Roots {
            home: agents.options.home.clone(),
            claude: agents.options.claude_home.clone(),
            codex: agents.options.codex_home.clone(),
        });
        match roots {
            Some(roots) => self.with_agent_session_roots(roots, seen_file),
            None => self,
        }
    }

    /// `with_agent_sessions` over folders given one by one (tests, a moved home).
    pub fn with_agent_session_roots(mut self, roots: Roots, seen_file: PathBuf) -> Self {
        self.sessions = Some(AgentSessions { roots, seen_file });
        self
    }

    /// Start the next sync over: on connect and disconnect, nothing read before counts.
    pub(crate) fn forget_sessions(&self) {
        if let Some(sessions) = &self.sessions {
            let _ = fs::remove_file(&sessions.seen_file);
        }
    }

    /// Read what changed since the last sync and write it to the index.
    pub(crate) fn run_sessions(&self) -> Result<(), String> {
        let sessions = self
            .sessions
            .as_ref()
            .ok_or_else(|| format!("no connector {SESSIONS}"))?;
        let index = self.index().map_err(|e| e.message)?.clone();
        let source = ItemSource {
            connector: SESSIONS.to_owned(),
            instance: INSTANCE.to_owned(),
        };
        let mut seen = Seen::load(&sessions.seen_file);
        let held = index
            .counts()
            .map_err(|e| e.message)?
            .into_iter()
            .find(|(s, _)| *s == source)
            .map_or(0, |(_, n)| n);
        // The index and the record disagree (rebuilt, cleared, a sync cut short): read it all again.
        if held != seen.ids().count() as u64 {
            index.clear(&source).map_err(|e| e.message)?;
            seen = Seen::fresh();
        }
        let changes = desk_sessions::sync(&sessions.roots, &mut seen);
        for batch in changes.upserted.chunks(BATCH) {
            index.upsert(batch).map_err(|e| e.message)?;
        }
        if !changes.removed.is_empty() {
            index
                .remove(&source, &changes.removed)
                .map_err(|e| e.message)?;
        }
        seen.save(&sessions.seen_file)
            .map_err(|e| format!("{SESSIONS} could not keep what it read: {e}"))
    }
}
