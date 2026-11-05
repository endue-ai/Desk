//! The memory folder's files: `facts.yaml` (`MemoryFactsFile`) and `episodes/<YYYY-MM>.jsonl` (one
//! `MemoryEpisode` per line). Every write goes through a temporary file and a rename, so a crash
//! leaves the old file or the new one. A line of an episode file that does not parse is skipped.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use desk_bridge::{MemoryEpisode, MemoryFact, MemoryFactKind, MemoryFactLine, MemoryFactsFile};

use crate::MemoryError;

pub const FACTS: &str = "facts.yaml";
pub const EPISODES: &str = "episodes";
/// The facts.yaml format this desk reads and writes.
pub const VERSION: u64 = 0;

const HEADER: &str = "# What Eris knows about you, one fact per item. Edit or delete lines freely: the desk\n\
# reads this file again when it changes. A new item needs only `text`.\n";

/// What `read_facts` found: the facts, and whether lines a person added still need an id.
pub struct Facts {
    pub facts: Vec<MemoryFact>,
    pub completed: bool,
}

/// The facts in `dir`, oldest first. A line without an id, writer or time (a hand edit) gets them now.
pub fn read_facts(
    dir: &Path,
    now: &str,
    mut new_id: impl FnMut() -> String,
) -> Result<Facts, MemoryError> {
    let path = dir.join(FACTS);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Facts {
                facts: Vec::new(),
                completed: false,
            });
        }
        Err(e) => return Err(io(&path, e)),
    };
    let file: Option<MemoryFactsFile> = yaml_serde::from_str(&text)
        .map_err(|e| MemoryError::Invalid(format!("{}: {e}", path.display())))?;
    let file = file.unwrap_or(MemoryFactsFile {
        version: VERSION,
        facts: None,
    });
    if file.version > VERSION {
        return Err(MemoryError::Invalid(format!(
            "{} is version {}; this desk reads version {VERSION}",
            path.display(),
            file.version
        )));
    }
    let mut completed = false;
    let facts = file
        .facts
        .unwrap_or_default()
        .into_iter()
        .map(|line| {
            completed |= line.id.is_none() || line.by.is_none() || line.at.is_none();
            MemoryFact {
                kind: MemoryFactKind::default(),
                id: line.id.unwrap_or_else(&mut new_id),
                text: line.text,
                by: line.by.unwrap_or_else(|| "person".to_owned()),
                at: line.at.unwrap_or_else(|| now.to_owned()),
                updated: line.updated,
                tags: line.tags,
            }
        })
        .collect();
    Ok(Facts { facts, completed })
}

pub fn write_facts(dir: &Path, facts: &[MemoryFact]) -> Result<(), MemoryError> {
    let file = MemoryFactsFile {
        version: VERSION,
        facts: Some(
            facts
                .iter()
                .map(|fact| MemoryFactLine {
                    id: Some(fact.id.clone()),
                    text: fact.text.clone(),
                    by: Some(fact.by.clone()),
                    at: Some(fact.at.clone()),
                    updated: fact.updated.clone(),
                    tags: fact.tags.clone(),
                })
                .collect(),
        ),
    };
    let yaml = yaml_serde::to_string(&file).map_err(|e| MemoryError::Io(e.to_string()))?;
    replace(&dir.join(FACTS), format!("{HEADER}{yaml}").as_bytes())
}

/// Every episode in `dir`, oldest month first and in the order each month's file holds them.
pub fn read_episodes(dir: &Path) -> Result<Vec<MemoryEpisode>, MemoryError> {
    let mut episodes = Vec::new();
    for path in month_files(dir)? {
        let text = fs::read_to_string(&path).map_err(|e| io(&path, e))?;
        episodes.extend(
            text.lines()
                .filter(|line| !line.trim().is_empty())
                .filter_map(|line| serde_json::from_str::<MemoryEpisode>(line).ok()),
        );
    }
    Ok(episodes)
}

/// Add `episode` at the end of its month's file.
pub fn append_episode(dir: &Path, month: &str, episode: &MemoryEpisode) -> Result<(), MemoryError> {
    let folder = dir.join(EPISODES);
    fs::create_dir_all(&folder).map_err(|e| io(&folder, e))?;
    let path = folder.join(format!("{month}.jsonl"));
    let line = serde_json::to_string(episode).map_err(|e| MemoryError::Io(e.to_string()))?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| io(&path, e))?;
    writeln!(file, "{line}").map_err(|e| io(&path, e))
}

/// Write each month's file again with only the episodes `keep` holds; an emptied month goes.
pub fn rewrite_episodes(dir: &Path, keep: &[MemoryEpisode]) -> Result<(), MemoryError> {
    for path in month_files(dir)? {
        let text = fs::read_to_string(&path).map_err(|e| io(&path, e))?;
        let kept: Vec<&str> = text
            .lines()
            .filter(|line| {
                serde_json::from_str::<MemoryEpisode>(line)
                    .is_ok_and(|episode| keep.iter().any(|k| k.id == episode.id))
            })
            .collect();
        if kept.is_empty() {
            fs::remove_file(&path).map_err(|e| io(&path, e))?;
        } else if kept.len() != text.lines().filter(|l| !l.trim().is_empty()).count() {
            replace(&path, format!("{}\n", kept.join("\n")).as_bytes())?;
        }
    }
    Ok(())
}

/// The month files, oldest first.
fn month_files(dir: &Path) -> Result<Vec<PathBuf>, MemoryError> {
    let folder = dir.join(EPISODES);
    let entries = match fs::read_dir(&folder) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(io(&folder, e)),
    };
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl"))
        .collect();
    paths.sort();
    Ok(paths)
}

/// What the files are now: each one's name, size and modification time. The index keeps the one it
/// was built from, and is built again when they differ (a hand edit, a file another desk synced).
pub fn fingerprint(dir: &Path) -> String {
    let mut parts = Vec::new();
    let mut add = |path: &Path| {
        if let Ok(meta) = fs::metadata(path) {
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_nanos());
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned());
            parts.push(format!(
                "{}:{}:{modified}",
                name.unwrap_or_default(),
                meta.len()
            ));
        }
    };
    add(&dir.join(FACTS));
    for path in month_files(dir).unwrap_or_default() {
        add(&path);
    }
    parts.join("|")
}

fn replace(path: &Path, bytes: &[u8]) -> Result<(), MemoryError> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes).map_err(|e| io(&temporary, e))?;
    fs::rename(&temporary, path).map_err(|e| io(path, e))
}

pub fn io(path: &Path, error: std::io::Error) -> MemoryError {
    MemoryError::Io(format!("{}: {error}", path.display()))
}
