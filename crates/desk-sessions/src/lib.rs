//! Local agent sessions as items (ADR 0403). Claude Code and Codex keep every session as a JSONL
//! transcript in their own folders; this crate reads those folders, read-only, and turns each
//! transcript into one `record` item of `specs/item/v0/agent-session.schema.json`: who ran it,
//! where, what the person asked, and the files, tickets, pull requests, ADRs, branches and
//! repositories it touched. The built-in connector `desk.agent-sessions` in desk-core calls `sync`
//! on its schedule and writes what changed to the item index.
//!
//! Only what the person wrote and the agent answered is kept, with harness-injected context taken
//! out and secrets masked; tool output and reasoning are skipped before they are parsed.

mod claude;
mod codex;
mod discover;
mod links;
mod seen;
mod session;
mod text;
mod time;

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{self, BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;

use desk_bridge::{AgentProgram, Item};

pub use discover::Transcript;
pub use links::Paths;
pub use seen::{Mark, Seen};
pub use session::{CONNECTOR, INSTANCE, SCHEMA};
pub use text::{MASK, redact, strip_injected};

/// Transcripts read at once.
const WORKERS: usize = 8;
/// A line longer than this is a tool's output or a file's copy, never a prompt; it is skipped.
const LINE_LIMIT: usize = 8 << 20;

/// Where each program keeps its sessions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Roots {
    pub home: PathBuf,
    /// Claude Code's folder: `$CLAUDE_CONFIG_DIR`, else `~/.claude`.
    pub claude: PathBuf,
    /// Codex's folder: `$CODEX_HOME`, else `~/.codex`.
    pub codex: PathBuf,
}

impl Roots {
    /// The usual folders under `home`, or where the environment moved them.
    pub fn new(home: &Path) -> Self {
        let from = |name: &str, default: &str| {
            std::env::var_os(name)
                .filter(|value| !value.is_empty())
                .map_or_else(|| home.join(default), PathBuf::from)
        };
        Self {
            home: home.to_path_buf(),
            claude: from("CLAUDE_CONFIG_DIR", ".claude"),
            codex: from("CODEX_HOME", ".codex"),
        }
    }

    /// The folders a person is shown as read.
    pub fn folders(&self) -> [PathBuf; 2] {
        [self.claude.join("projects"), self.codex.join("sessions")]
    }
}

/// What one sync found: items to write and the ids of items whose transcripts are gone.
#[derive(Debug, Default)]
pub struct Changes {
    pub upserted: Vec<Item>,
    pub removed: Vec<String>,
}

/// Read every transcript that changed since `seen`, and update `seen`.
pub fn sync(roots: &Roots, seen: &mut Seen) -> Changes {
    let paths = Paths::new(&roots.home.to_string_lossy());
    let found = discover::find(&roots.claude, &roots.codex);
    let titles = codex::titles(&roots.codex);
    let before: HashSet<String> = seen.ids().map(str::to_owned).collect();
    let present: HashSet<String> = found.iter().map(|t| key(&t.path)).collect();
    seen.files.retain(|path, _| present.contains(path));
    let todo: Vec<&Transcript> = found
        .iter()
        .filter(|t| changed(t, seen.files.get(&key(&t.path)), &titles))
        .collect();
    let read = read_all(&todo, &titles, &paths);
    let mut changes = Changes::default();
    for (transcript, outcome) in todo.into_iter().zip(read) {
        let Ok(item) = outcome else {
            continue;
        };
        let (id, title) = item.as_ref().map_or((String::new(), None), |item| {
            let Item::Record(record) = item else {
                return (String::new(), None);
            };
            let title = (transcript.agent == AgentProgram::Codex)
                .then(|| titles.get(session_id(&record.id)).cloned())
                .flatten();
            (record.id.clone(), title)
        });
        let mark = Mark {
            size: transcript.size,
            modified: transcript.modified,
            id,
            title,
        };
        seen.files.insert(key(&transcript.path), mark);
        changes.upserted.extend(item);
    }
    let after: HashSet<&str> = seen.ids().collect();
    changes.removed = before
        .into_iter()
        .filter(|id| !after.contains(id.as_str()))
        .collect();
    changes.removed.sort();
    changes
}

fn key(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// The program's id from an item id `<agent>:<id>`.
fn session_id(item_id: &str) -> &str {
    item_id.split_once(':').map_or(item_id, |(_, id)| id)
}

/// Whether a transcript needs reading: new, grown, touched, or renamed (a Codex thread).
fn changed(transcript: &Transcript, mark: Option<&Mark>, titles: &HashMap<String, String>) -> bool {
    let Some(mark) = mark else {
        return true;
    };
    if mark.size != transcript.size || mark.modified != transcript.modified {
        return true;
    }
    transcript.agent == AgentProgram::Codex
        && !mark.id.is_empty()
        && titles.get(session_id(&mark.id)) != mark.title.as_ref()
}

/// Read transcripts on up to `WORKERS` threads, in order. An unreadable one is an error and is
/// tried again at the next sync.
fn read_all(
    todo: &[&Transcript],
    titles: &HashMap<String, String>,
    paths: &Paths,
) -> Vec<io::Result<Option<Item>>> {
    let slots: Vec<Mutex<Option<io::Result<Option<Item>>>>> =
        todo.iter().map(|_| Mutex::new(None)).collect();
    let next = AtomicUsize::new(0);
    let workers = thread::available_parallelism().map_or(2, |n| n.get().min(WORKERS));
    thread::scope(|scope| {
        for _ in 0..workers.min(todo.len().max(1)) {
            scope.spawn(|| {
                loop {
                    let at = next.fetch_add(1, Ordering::Relaxed);
                    let Some(transcript) = todo.get(at) else {
                        break;
                    };
                    let item = read_one(transcript, titles, paths);
                    if let Ok(mut slot) = slots[at].lock() {
                        *slot = Some(item);
                    }
                }
            });
        }
    });
    slots
        .into_iter()
        .map(|slot| {
            let taken = slot.into_inner().ok().flatten();
            taken.unwrap_or_else(|| Err(io::Error::other("not read")))
        })
        .collect()
}

/// One transcript as an item; `None` when it holds nothing a person would look for.
pub fn read_one(
    transcript: &Transcript,
    titles: &HashMap<String, String>,
    paths: &Paths,
) -> io::Result<Option<Item>> {
    let session = match transcript.agent {
        AgentProgram::Claude => Some(claude::read(
            &transcript.path,
            transcript.parent.as_deref(),
            paths,
        )?),
        AgentProgram::Codex => codex::read(&transcript.path, titles, paths)?,
        AgentProgram::Hermes => None,
    };
    Ok(session.filter(|s| !s.is_empty()).map(|mut session| {
        session.modified(transcript.modified);
        session.into_item()
    }))
}

/// Call `each` with every line of `path` that is UTF-8 and not longer than `LINE_LIMIT`; a `.zst`
/// file is decompressed as it is read (Codex compresses older sessions, ADR 0110).
pub(crate) fn each_line(path: &Path, mut each: impl FnMut(&str)) -> io::Result<()> {
    let file = File::open(path)?;
    let source: Box<dyn Read> = if path.extension().is_some_and(|e| e == "zst") {
        let decoder = ruzstd::decoding::StreamingDecoder::new(BufReader::new(file))
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;
        Box::new(decoder)
    } else {
        Box::new(file)
    };
    let mut reader = BufReader::with_capacity(1 << 20, source);
    let mut line = Vec::new();
    loop {
        line.clear();
        if reader.read_until(b'\n', &mut line)? == 0 {
            return Ok(());
        }
        if line.len() > LINE_LIMIT {
            continue;
        }
        if let Ok(text) = std::str::from_utf8(&line) {
            each(text.trim_end());
        }
    }
}
