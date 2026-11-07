//! Eris's memory on this computer (specs/memory/v0, ADR 0095). One folder holds it: `facts.yaml`
//! (facts and preferences a person reads and edits), `episodes/<YYYY-MM>.jsonl` (what was asked, done
//! and answered) and `index.sqlite` (full-text search, derived from both). The files are the truth:
//! a hand edit or a file another desk synced is read on the next call, and the index follows.

mod files;
mod ids;
mod index;
mod time;

use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::SystemTime;

pub use desk_bridge::{MemoryEntry, MemoryEpisode, MemoryFact, MemoryHit, MemoryKind, MemoryStep};
use desk_bridge::{MemoryEpisodeKind, MemoryFactKind};

use crate::index::{Index, Row};

/// Why a memory call failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemoryError {
    /// No entry has this id.
    NotFound(String),
    /// A file or an argument is not what memory reads.
    Invalid(String),
    /// The disk or the index failed.
    Io(String),
}

impl fmt::Display for MemoryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(why) | Self::Invalid(why) | Self::Io(why) => f.write_str(why),
        }
    }
}

/// One page of `list`, and the cursor of the next when there is more.
#[derive(Debug, Clone, PartialEq)]
pub struct Page {
    pub entries: Vec<MemoryEntry>,
    pub next: Option<String>,
}

type Clock = Arc<dyn Fn() -> SystemTime + Send + Sync>;

/// The memory in one folder. Calls are serialised; each one first reads files that changed.
pub struct Memory {
    dir: PathBuf,
    clock: Clock,
    state: Mutex<State>,
}

struct State {
    facts: Vec<MemoryFact>,
    episodes: Vec<MemoryEpisode>,
    index: Index,
    /// The files as last read or written.
    seen: String,
}

impl Memory {
    /// The memory in `dir`, made when missing. A facts.yaml from a newer desk is refused.
    pub fn open(dir: impl AsRef<Path>) -> Result<Self, MemoryError> {
        let dir = dir.as_ref().to_path_buf();
        std::fs::create_dir_all(&dir).map_err(|e| files::io(&dir, e))?;
        let index = Index::open(&dir)?;
        let memory = Self {
            dir,
            clock: Arc::new(SystemTime::now),
            state: Mutex::new(State {
                facts: Vec::new(),
                episodes: Vec::new(),
                index,
                seen: String::new(),
            }),
        };
        drop(memory.fresh()?);
        Ok(memory)
    }

    /// Read the time from `clock` instead of the system clock, for tests.
    pub fn with_clock(mut self, clock: impl Fn() -> SystemTime + Send + Sync + 'static) -> Self {
        self.clock = Arc::new(clock);
        self
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Keep a new fact written by `by` (person, eris, a plugin id or agent:<id>).
    pub fn remember(
        &self,
        text: &str,
        tags: Option<Vec<String>>,
        by: &str,
    ) -> Result<MemoryFact, MemoryError> {
        let text = words(text, 2000)?;
        let mut state = self.fresh()?;
        let at = (self.clock)();
        let fact = MemoryFact {
            kind: MemoryFactKind::default(),
            id: ids::new_id("fact", time::millis(at)),
            text,
            by: by.to_owned(),
            at: time::rfc3339(at),
            updated: None,
            tags: tags.filter(|tags| !tags.is_empty()),
        };
        state.facts.push(fact.clone());
        files::write_facts(&self.dir, &state.facts)?;
        let seen = files::fingerprint(&self.dir);
        state.index.put(&fact_row(&fact), &seen)?;
        state.seen = seen;
        Ok(fact)
    }

    /// Change the words (and the tags, when given) of the fact `id`.
    pub fn edit(
        &self,
        id: &str,
        text: &str,
        tags: Option<Vec<String>>,
    ) -> Result<MemoryFact, MemoryError> {
        let text = words(text, 2000)?;
        let mut state = self.fresh()?;
        let at = time::rfc3339((self.clock)());
        let fact = state
            .facts
            .iter_mut()
            .find(|fact| fact.id == id)
            .ok_or_else(|| MemoryError::NotFound(format!("no fact {id}")))?;
        fact.text = text;
        fact.updated = Some(at);
        if let Some(tags) = tags {
            fact.tags = (!tags.is_empty()).then_some(tags);
        }
        let fact = fact.clone();
        files::write_facts(&self.dir, &state.facts)?;
        let seen = files::fingerprint(&self.dir);
        state.index.put(&fact_row(&fact), &seen)?;
        state.seen = seen;
        Ok(fact)
    }

    /// Keep an episode: what was asked, the commands run and what was answered.
    pub fn record(
        &self,
        asked: &str,
        answered: &str,
        steps: Vec<MemoryStep>,
        by: &str,
    ) -> Result<MemoryEpisode, MemoryError> {
        let asked = words(asked, 8000)?;
        let mut state = self.fresh()?;
        let at = (self.clock)();
        let episode = MemoryEpisode {
            kind: MemoryEpisodeKind::default(),
            id: ids::new_id("ep", time::millis(at)),
            at: time::rfc3339(at),
            by: by.to_owned(),
            asked,
            answered: answered.chars().take(16_000).collect(),
            steps: (!steps.is_empty()).then_some(steps),
        };
        files::append_episode(&self.dir, &time::month(at), &episode)?;
        state.episodes.push(episode.clone());
        let seen = files::fingerprint(&self.dir);
        state.index.put(&episode_row(&episode), &seen)?;
        state.seen = seen;
        Ok(episode)
    }

    pub fn get(&self, id: &str) -> Result<MemoryEntry, MemoryError> {
        let state = self.fresh()?;
        entry(&state, id).ok_or_else(|| MemoryError::NotFound(format!("no memory {id}")))
    }

    /// Entries newest first, `limit` at a time, after the entry `cursor` names.
    pub fn list(
        &self,
        kind: Option<MemoryKind>,
        limit: usize,
        cursor: Option<&str>,
    ) -> Result<Page, MemoryError> {
        let state = self.fresh()?;
        let mut all: Vec<MemoryEntry> = Vec::new();
        if kind != Some(MemoryKind::Episode) {
            all.extend(state.facts.iter().cloned().map(MemoryEntry::MemoryFact));
        }
        if kind != Some(MemoryKind::Fact) {
            all.extend(
                state
                    .episodes
                    .iter()
                    .cloned()
                    .map(MemoryEntry::MemoryEpisode),
            );
        }
        all.sort_by(|a, b| ids::order(id(b)).cmp(ids::order(id(a))));
        let after = cursor.map(ids::order);
        let mut rest = all
            .into_iter()
            .filter(|entry| after.is_none_or(|after| ids::order(id(entry)) < after));
        let entries: Vec<MemoryEntry> = rest.by_ref().take(limit.max(1)).collect();
        let next = rest
            .next()
            .and(entries.last().map(|last| id(last).to_owned()));
        Ok(Page { entries, next })
    }

    /// Entries whose words match the query's, best first.
    pub fn search(
        &self,
        query: &str,
        kind: Option<MemoryKind>,
        limit: usize,
    ) -> Result<Vec<MemoryHit>, MemoryError> {
        let state = self.fresh()?;
        let kind = kind.map(|kind| match kind {
            MemoryKind::Fact => "fact",
            MemoryKind::Episode => "episode",
        });
        let found = state.index.search(query, kind, limit.max(1))?;
        Ok(found
            .into_iter()
            .filter_map(|(id, snippet)| {
                entry(&state, &id).map(|entry| MemoryHit { entry, snippet })
            })
            .collect())
    }

    /// Forget the entry `id`, from the disk and the index; 0 when there is none.
    pub fn forget(&self, id: &str) -> Result<usize, MemoryError> {
        let mut state = self.fresh()?;
        if state.facts.iter().any(|fact| fact.id == id) {
            state.facts.retain(|fact| fact.id != id);
            files::write_facts(&self.dir, &state.facts)?;
        } else if state.episodes.iter().any(|episode| episode.id == id) {
            state.episodes.retain(|episode| episode.id != id);
            files::rewrite_episodes(&self.dir, &state.episodes)?;
        } else {
            return Ok(0);
        }
        let seen = files::fingerprint(&self.dir);
        state.index.remove(&[id.to_owned()], &seen)?;
        state.seen = seen;
        Ok(1)
    }

    /// Forget every entry, or every entry of `kind`; answers how many went.
    pub fn forget_all(&self, kind: Option<MemoryKind>) -> Result<usize, MemoryError> {
        let mut state = self.fresh()?;
        let mut gone: Vec<String> = Vec::new();
        if kind != Some(MemoryKind::Episode) {
            gone.extend(state.facts.drain(..).map(|fact| fact.id));
            files::write_facts(&self.dir, &state.facts)?;
        }
        if kind != Some(MemoryKind::Fact) {
            gone.extend(state.episodes.drain(..).map(|episode| episode.id));
            files::rewrite_episodes(&self.dir, &state.episodes)?;
        }
        let seen = files::fingerprint(&self.dir);
        state.index.remove(&gone, &seen)?;
        state.seen = seen;
        Ok(gone.len())
    }

    /// The state, read again from the files when they changed since the last call, with the index
    /// built again when it was built from other files.
    fn fresh(&self) -> Result<MutexGuard<'_, State>, MemoryError> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = files::fingerprint(&self.dir);
        if now == state.seen && !state.seen.is_empty() {
            return Ok(state);
        }
        let at = (self.clock)();
        let read = files::read_facts(&self.dir, &time::rfc3339(at), || {
            ids::new_id("fact", time::millis(at))
        })?;
        state.facts = read.facts;
        if read.completed {
            // Ids for the lines a person added, written back so they stay the same.
            files::write_facts(&self.dir, &state.facts)?;
        }
        state.episodes = files::read_episodes(&self.dir)?;
        let seen = files::fingerprint(&self.dir);
        if read.completed || state.index.fingerprint().as_deref() != Some(seen.as_str()) {
            let State {
                facts,
                episodes,
                index,
                ..
            } = &mut *state;
            let rows = facts
                .iter()
                .map(fact_row)
                .chain(episodes.iter().map(episode_row));
            index.rebuild(rows, &seen)?;
        }
        state.seen = seen;
        Ok(state)
    }
}

fn id(entry: &MemoryEntry) -> &str {
    match entry {
        MemoryEntry::MemoryFact(fact) => &fact.id,
        MemoryEntry::MemoryEpisode(episode) => &episode.id,
    }
}

fn entry(state: &State, id: &str) -> Option<MemoryEntry> {
    let fact = state.facts.iter().find(|fact| fact.id == id);
    let episode = || state.episodes.iter().find(|episode| episode.id == id);
    fact.cloned()
        .map(MemoryEntry::MemoryFact)
        .or_else(|| episode().cloned().map(MemoryEntry::MemoryEpisode))
}

fn fact_row(fact: &MemoryFact) -> Row<'_> {
    let tags = fact.tags.as_deref().unwrap_or_default().join(" ");
    Row {
        id: &fact.id,
        kind: "fact",
        text: format!("{} {tags}", fact.text),
    }
}

fn episode_row(episode: &MemoryEpisode) -> Row<'_> {
    Row {
        id: &episode.id,
        kind: "episode",
        text: format!("{}\n{}", episode.asked, episode.answered),
    }
}

/// Text that is not empty once trimmed, at most `max` characters.
fn words(text: &str, max: usize) -> Result<String, MemoryError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(MemoryError::Invalid("memory needs words".to_owned()));
    }
    if text.chars().count() > max {
        return Err(MemoryError::Invalid(format!("at most {max} characters")));
    }
    Ok(text.to_owned())
}
