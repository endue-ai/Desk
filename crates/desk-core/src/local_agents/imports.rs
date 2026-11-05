//! The desk's copies of agent sessions: `<data>/agents/<agent>/index.json` lists each imported
//! session with the size and time of the file it was copied from, and `<id>.json` holds the
//! session with its last turns, so it stays readable when the program drops or compresses its
//! file. Without a data folder the copies live in memory only. Files are written whole through a
//! temporary file and a rename.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use desk_bridge::{LocalAgentId, LocalAgentMessage, LocalAgentSession};
use serde::{Deserialize, Serialize};

use super::discover::KNOWN;
use super::{Found, agent_name, is_session_id};

/// One imported session in the index.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    session: LocalAgentSession,
    source_size: u64,
    source_modified: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct IndexFile {
    sessions: Vec<Entry>,
}

/// One copy: the session and its last turns.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Copy {
    pub(crate) session: LocalAgentSession,
    pub(crate) messages: Vec<LocalAgentMessage>,
    pub(crate) truncated: bool,
}

pub(crate) struct Imports {
    dir: Option<PathBuf>,
    index: HashMap<LocalAgentId, BTreeMap<String, Entry>>,
    /// The copies themselves, when there is no data folder.
    memory: HashMap<(LocalAgentId, String), Copy>,
}

impl Imports {
    /// The copies under `data`, each agent's index read once now.
    pub(crate) fn open(data: Option<PathBuf>) -> Self {
        let mut index = HashMap::new();
        for agent in KNOWN {
            let entries = data
                .as_deref()
                .and_then(|d| fs::read(index_path(d, agent)).ok())
                .and_then(|bytes| serde_json::from_slice::<IndexFile>(&bytes).ok())
                .map(|file| {
                    let valid = file
                        .sessions
                        .into_iter()
                        .filter(|e| is_session_id(&e.session.id));
                    valid.map(|e| (e.session.id.clone(), e)).collect()
                })
                .unwrap_or_default();
            index.insert(agent, entries);
        }
        Self {
            dir: data,
            index,
            memory: HashMap::new(),
        }
    }

    fn entries(&self, agent: LocalAgentId) -> impl Iterator<Item = &Entry> {
        self.index
            .get(&agent)
            .into_iter()
            .flat_map(BTreeMap::values)
    }

    pub(crate) fn count(&self, agent: LocalAgentId) -> usize {
        self.index.get(&agent).map_or(0, BTreeMap::len)
    }

    /// When `id` was imported, when it was.
    pub(crate) fn imported_at(&self, agent: LocalAgentId, id: &str) -> Option<String> {
        let entry = self.index.get(&agent)?.get(id)?;
        entry.session.imported_at.clone()
    }

    /// The imported sessions, the newest first, each with its copy's file.
    pub(crate) fn found(&self, agent: LocalAgentId) -> Vec<Found> {
        let mut found: Vec<Found> = self
            .entries(agent)
            .map(|e| Found {
                session: e.session.clone(),
                path: self.copy_path(agent, &e.session.id).unwrap_or_default(),
                modified: e.source_modified,
            })
            .collect();
        found.sort_by(|a, b| b.session.updated_at.cmp(&a.session.updated_at));
        found
    }

    /// Whether the copy of `found` was made from its file as it is now.
    pub(crate) fn unchanged(&self, agent: LocalAgentId, found: &Found) -> bool {
        self.index
            .get(&agent)
            .and_then(|entries| entries.get(&found.session.id))
            .is_some_and(|e| {
                e.source_size == found.session.size && e.source_modified == found.modified
            })
    }

    /// Keep a copy of `found` with its turns, imported `now`.
    pub(crate) fn keep(
        &mut self,
        agent: LocalAgentId,
        found: &Found,
        messages: Vec<LocalAgentMessage>,
        truncated: bool,
        now: String,
    ) -> io::Result<()> {
        let mut session = found.session.clone();
        session.imported = true;
        session.imported_at = Some(now);
        let copy = Copy {
            session: session.clone(),
            messages,
            truncated,
        };
        let id = session.id.clone();
        match self.copy_path(agent, &id) {
            Some(path) => write(&path, &serde_json::to_vec(&copy)?)?,
            None => {
                self.memory.insert((agent, id.clone()), copy);
            }
        }
        let entry = Entry {
            session,
            source_size: found.session.size,
            source_modified: found.modified,
        };
        self.index.entry(agent).or_default().insert(id, entry);
        self.save(agent)
    }

    /// The copy of one session.
    pub(crate) fn copy(&self, agent: LocalAgentId, id: &str) -> Option<Copy> {
        self.index.get(&agent)?.get(id)?;
        match self.copy_path(agent, id) {
            Some(path) => serde_json::from_slice(&fs::read(path).ok()?).ok(),
            None => self.memory.get(&(agent, id.to_owned())).cloned(),
        }
    }

    fn copy_path(&self, agent: LocalAgentId, id: &str) -> Option<PathBuf> {
        let dir = self.dir.as_deref()?;
        is_session_id(id).then(|| dir.join(agent_name(agent)).join(format!("{id}.json")))
    }

    fn save(&self, agent: LocalAgentId) -> io::Result<()> {
        let Some(dir) = &self.dir else {
            return Ok(());
        };
        let file = IndexFile {
            sessions: self.entries(agent).cloned().collect(),
        };
        write(&index_path(dir, agent), &serde_json::to_vec_pretty(&file)?)
    }
}

fn index_path(data: &Path, agent: LocalAgentId) -> PathBuf {
    data.join(agent_name(agent)).join("index.json")
}

/// `bytes` into `path` whole: a temporary file beside it, renamed over it.
fn write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(dir)?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("copy");
    let temp = dir.join(format!(".{name}.{}.tmp", std::process::id()));
    fs::write(&temp, bytes)?;
    fs::rename(&temp, path).inspect_err(|_| {
        let _ = fs::remove_file(&temp);
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use desk_bridge::LocalAgentRole;

    fn found(id: &str, size: u64) -> Found {
        Found {
            session: LocalAgentSession {
                id: id.to_owned(),
                agent: LocalAgentId::Codex,
                title: "Rename the loader".to_owned(),
                cwd: None,
                branch: None,
                started_at: None,
                updated_at: "2026-11-05T09:00:00Z".to_owned(),
                archived: true,
                imported: false,
                imported_at: None,
                size,
                version: None,
                model: None,
            },
            path: PathBuf::from("/nowhere"),
            modified: 7,
        }
    }

    #[test]
    fn a_copy_survives_a_new_start_and_knows_when_its_file_changed() {
        let dir = std::env::temp_dir().join(format!("desk-imports-{}", std::process::id()));
        let mut imports = Imports::open(Some(dir.clone()));
        let said = LocalAgentMessage {
            role: LocalAgentRole::User,
            text: "hi".to_owned(),
            name: None,
            at: None,
            cut: None,
        };
        let f = found("s-1", 10);
        imports
            .keep(
                LocalAgentId::Codex,
                &f,
                vec![said],
                false,
                "2026-11-05T10:00:00Z".to_owned(),
            )
            .unwrap();
        let again = Imports::open(Some(dir.clone()));
        assert!(again.unchanged(LocalAgentId::Codex, &f));
        assert!(!again.unchanged(LocalAgentId::Codex, &found("s-1", 11)));
        assert_eq!(again.count(LocalAgentId::Codex), 1);
        let copy = again.copy(LocalAgentId::Codex, "s-1").unwrap();
        assert_eq!(copy.messages.len(), 1);
        assert_eq!(
            copy.session.imported_at.as_deref(),
            Some("2026-11-05T10:00:00Z")
        );
        assert!(copy.session.imported);
        assert!(again.copy(LocalAgentId::Claude, "s-1").is_none());
        fs::remove_dir_all(&dir).unwrap();
    }
}
