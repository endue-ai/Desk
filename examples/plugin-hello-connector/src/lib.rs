//! The smallest connector. Each instance reads one folder (its `folder` setting) and turns the
//! markdown files at its top into `note` items: the first `# heading` or the file name is the title,
//! the text is the body, the file's modification time is `updatedAt`. It polls, since `fs.list` is
//! not recursive and there is no watch: its cursor is the modification time of every file it has
//! reported, so a sync sends only what changed, 50 files per round. Everything it touches goes
//! through `desk:host` (specs/wit), and the host stamps each item's `source`.

wit_bindgen::generate!({
    path: "../../specs/wit",
    world: "desk:connector/connector",
    generate_all,
});

use std::collections::BTreeMap;

use desk::connector::types::{Item, ItemChange, ItemKind};
use desk::host::fs::{self, EntryKind};
use desk::host::types::ErrorCode;
use serde_json::{Value, json};

/// Changes per round; while there are more, the host calls `sync` again at once.
const ROUND: usize = 50;

struct HelloConnector;

impl Guest for HelloConnector {
    fn sync(instance: Instance, cursor: Option<String>) -> Result<SyncResult, Error> {
        let folder = folder(&instance)?;
        let files = markdown(&folder)?;
        // File name to the modification time it was reported with; anything else starts over.
        let mut reported: BTreeMap<String, String> = cursor
            .and_then(|cursor| serde_json::from_str(&cursor).ok())
            .unwrap_or_default();
        let changed = files
            .iter()
            .filter(|(name, at)| reported.get(*name) != Some(*at));
        let gone = reported.keys().filter(|name| !files.contains_key(*name));
        let pending: Vec<(String, Option<String>)> = changed
            .map(|(name, at)| (name.clone(), Some(at.clone())))
            .chain(gone.map(|name| (name.clone(), None)))
            .collect();

        let mut changes = Vec::new();
        for (name, modified_at) in pending.iter().take(ROUND) {
            match modified_at {
                Some(at) => {
                    changes.push(ItemChange::Upserted(note(&folder, name, at)?));
                    reported.insert(name.clone(), at.clone());
                }
                None => {
                    changes.push(ItemChange::Removed(name.clone()));
                    reported.remove(name);
                }
            }
        }
        Ok(SyncResult {
            changes,
            cursor: serde_json::to_string(&reported).ok(),
            done: pending.len() <= ROUND,
        })
    }

    fn query(_instance: Instance, _query: ItemQuery) -> Result<ItemPage, Error> {
        Err(unsupported(
            "hello-connector has no live query: the index holds every note",
        ))
    }

    fn act(_instance: Instance, action: String, _args_json: String) -> Result<String, Error> {
        Err(unsupported(&format!(
            "hello-connector has no action {action}"
        )))
    }

    fn status(instance: Instance) -> Result<(), Error> {
        fs::list(&folder(&instance)?).map(drop)
    }
}

/// The instance's `folder` setting.
fn folder(instance: &Instance) -> Result<String, Error> {
    let settings: Value = serde_json::from_str(&instance.settings).unwrap_or_default();
    match settings["folder"].as_str() {
        Some(folder) if !folder.is_empty() => Ok(folder.to_owned()),
        _ => Err(Error {
            code: ErrorCode::InvalidParams,
            message: "set the folder to read notes from".into(),
        }),
    }
}

/// The `*.md` files at the top of `folder`, by name, with when each last changed.
fn markdown(folder: &str) -> Result<BTreeMap<String, String>, Error> {
    let mut files = BTreeMap::new();
    for entry in fs::list(folder)? {
        if entry.kind != EntryKind::File || !entry.name.ends_with(".md") {
            continue;
        }
        let Some(modified_at) = entry.modified_at else {
            let why = format!("the desk cannot tell when {} changed", entry.name);
            return Err(unsupported(&why));
        };
        files.insert(entry.name, modified_at);
    }
    Ok(files)
}

/// The note for the file `name` in `folder`.
fn note(folder: &str, name: &str, modified_at: &str) -> Result<Item, Error> {
    let path = if folder.ends_with(['/', '\\']) {
        format!("{folder}{name}")
    } else {
        format!("{folder}/{name}")
    };
    let text = String::from_utf8_lossy(&fs::read(&path)?).into_owned();
    let title = heading(&text).unwrap_or_else(|| name.trim_end_matches(".md").to_owned());
    Ok(Item {
        id: name.to_owned(),
        kind: ItemKind::Note,
        title,
        updated_at: modified_at.to_owned(),
        created_at: None,
        deep_link: Some(file_url(&path)),
        body: Some(text),
        details: json!({ "path": path }).to_string(),
        raw: None,
    })
}

/// The text of the first `# heading`, when it has any.
fn heading(text: &str) -> Option<String> {
    let first = text.lines().find_map(|line| line.strip_prefix("# "))?;
    Some(first.trim().to_owned()).filter(|title| !title.is_empty())
}

/// A `file://` URL for `path`, with forward slashes (`file:///C:/…` on Windows) and every byte
/// but letters, digits, `-._~`, `/` and `:` percent-encoded.
fn file_url(path: &str) -> String {
    let path = path.replace('\\', "/");
    let mut url = String::from(if path.starts_with('/') {
        "file://"
    } else {
        "file:///"
    });
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~/:".contains(&byte) {
            url.push(char::from(byte));
        } else {
            url.push_str(&format!("%{byte:02X}"));
        }
    }
    url
}

fn unsupported(message: &str) -> Error {
    Error {
        code: ErrorCode::Unsupported,
        message: message.to_owned(),
    }
}

export!(HelloConnector);
