//! The files that make a desk (ADR 0079): the person's desk folder, `~/.desk` (init.yaml,
//! profiles/<id>.yaml, keys.yaml, views/<id>.yaml, plugins.lock), and the desk's data folder (its
//! state files). `desk doctor` lists them with who writes them, their size and whether they read
//! as their spec says; `desk export` and `desk import` carry the desk folder and, asked, the data
//! files that are safe to carry. Problems name the line where the YAML says it.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde_json::{Value, json};

use crate::core_views::{ViewFile, read_view};
use crate::init::{Step, line_of};
use crate::manifest::schema_registry;

/// The desk folder's single files an export carries, by path under `~/.desk`.
pub const DESK_FILES: [&str; 3] = ["init.yaml", "keys.yaml", "plugins.lock"];
/// The desk folder's folders whose YAML files an export carries.
pub const DESK_FOLDERS: [&str; 2] = ["profiles", "views"];
/// The data files `--with-data` carries: never secrets.json (connector credentials), account.json
/// (the endue ID token), the sync files, the index, the history or the socket.
pub const DATA_FILES: [&str; 5] = [
    "store.json",
    "grants.json",
    "settings.json",
    "plugins.json",
    "brain.json",
];

/// Who writes a file: the person (by hand or through the desk), or the desk alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Owner {
    Person,
    Desk,
}

impl Owner {
    pub fn as_str(self) -> &'static str {
        match self {
            Owner::Person => "person",
            Owner::Desk => "desk",
        }
    }
}

/// Whether a file reads as its spec says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileState {
    Valid,
    /// What is wrong: `line N: ...` when the file says where.
    Invalid(String),
    /// Nothing checks it (a database, a folder, a file without a spec yet).
    Unchecked,
}

impl FileState {
    pub fn label(&self) -> String {
        match self {
            FileState::Valid => "valid".to_owned(),
            FileState::Invalid(why) => format!("invalid: {why}"),
            FileState::Unchecked => "unchecked".to_owned(),
        }
    }
}

/// One file of the desk, as doctor lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeskFile {
    pub path: PathBuf,
    pub owner: Owner,
    /// Bytes; a folder's is the sum of the files in it.
    pub size: u64,
    pub state: FileState,
}

/// The desk folder's files under `home`, then the data folder's, each checked. The data folder is
/// listed one level deep: a folder in it (history, themes) is one line.
pub fn desk_files(home: &Path, data: &Path) -> Vec<DeskFile> {
    let desk = home.join(".desk");
    let mut files: Vec<DeskFile> = desk_folder_files(&desk)
        .into_iter()
        .map(|rel| {
            let path = desk.join(&rel);
            let owner = if rel == Path::new("plugins.lock") {
                Owner::Desk
            } else {
                Owner::Person
            };
            DeskFile {
                size: size_of(&path),
                state: check_desk_file(&rel, &path),
                path,
                owner,
            }
        })
        .collect();
    let mut entries: Vec<PathBuf> = fs::read_dir(data)
        .map(|read| read.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    entries.sort();
    files.extend(entries.into_iter().map(|path| DeskFile {
        size: size_of(&path),
        state: check_data_file(&path),
        owner: Owner::Desk,
        path,
    }));
    files
}

/// The paths, relative to the desk folder `desk`, of the files an export carries that exist.
pub fn desk_folder_files(desk: &Path) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = DESK_FILES
        .iter()
        .map(PathBuf::from)
        .filter(|rel| desk.join(rel).is_file())
        .collect();
    for folder in DESK_FOLDERS {
        let mut names: Vec<PathBuf> = fs::read_dir(desk.join(folder))
            .map(|read| {
                read.flatten()
                    .filter(|e| e.path().is_file())
                    .map(|e| PathBuf::from(folder).join(e.file_name()))
                    .filter(|p| p.extension().is_some_and(|x| x == "yaml"))
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        found.extend(names);
    }
    found
}

/// Check one desk folder file, by its path under `~/.desk`.
pub fn check_desk_file(rel: &Path, path: &Path) -> FileState {
    let Ok(text) = fs::read_to_string(path) else {
        return FileState::Invalid("cannot be read as UTF-8 text".to_owned());
    };
    let name = rel.to_string_lossy().replace('\\', "/");
    let schema = match name.as_str() {
        "init.yaml" => "https://endue.ai/specs/init/v0/init.schema.json#/$defs/InitDocument",
        "keys.yaml" => "https://endue.ai/specs/init/v0/keys.schema.json#/$defs/KeysFile",
        _ if name.starts_with("profiles/") => {
            "https://endue.ai/specs/init/v0/profile.schema.json#/$defs/ProfileFile"
        }
        _ if name.starts_with("views/") => {
            return match read_view(path) {
                Ok(ViewFile::Valid(..)) => FileState::Valid,
                Ok(ViewFile::Invalid(why)) => FileState::Invalid(why),
                Err(e) => FileState::Invalid(e.to_string()),
            };
        }
        "plugins.lock" => "https://endue.ai/specs/init/v0/lock.schema.json#/$defs/PluginsLock",
        _ => return FileState::Unchecked,
    };
    yaml_state(&text, schema)
}

/// A YAML file against `schema`: its parse error's line, or the first schema problem's.
fn yaml_state(text: &str, schema: &str) -> FileState {
    let value = match yaml_serde::from_str::<Option<Value>>(text) {
        Ok(value) => value.unwrap_or(Value::Null),
        Err(e) => {
            let line = e.location().map(|at| format!("line {}: ", at.line()));
            return FileState::Invalid(format!("{}not YAML: {e}", line.unwrap_or_default()));
        }
    };
    let Some(error) = validator(schema).iter_errors(&value).next() else {
        return FileState::Valid;
    };
    let pointer = error.instance_path().to_string();
    let segments: Vec<String> = pointer
        .split('/')
        .skip(1)
        .map(|s| s.replace("~1", "/").replace("~0", "~"))
        .collect();
    let message = error.to_string();
    // An unexpected key is named in the message, not the pointer: its own line says where.
    let unexpected = message
        .split_once('\'')
        .and_then(|(_, rest)| rest.split_once("' was unexpected"))
        .map(|(key, _)| key.to_owned());
    let mut steps: Vec<Step> = segments
        .iter()
        .map(|s| match s.parse::<usize>() {
            Ok(index) => Step::Index(index),
            Err(_) => Step::Key(s),
        })
        .collect();
    if let Some(key) = &unexpected {
        steps.push(Step::Key(key));
    }
    let line = line_of(text, &steps)
        .or_else(|| steps.is_empty().then_some(1))
        .map(|n| format!("line {n}: "));
    let at = if pointer.is_empty() {
        "/".to_owned()
    } else {
        pointer
    };
    FileState::Invalid(format!("{}{at}: {message}", line.unwrap_or_default()))
}

fn validator(schema: &str) -> &'static jsonschema::Validator {
    static INIT: OnceLock<jsonschema::Validator> = OnceLock::new();
    static KEYS: OnceLock<jsonschema::Validator> = OnceLock::new();
    static PROFILE: OnceLock<jsonschema::Validator> = OnceLock::new();
    static LOCK: OnceLock<jsonschema::Validator> = OnceLock::new();
    let cell = if schema.contains("/keys.") {
        &KEYS
    } else if schema.contains("/profile.") {
        &PROFILE
    } else if schema.contains("/lock.") {
        &LOCK
    } else {
        &INIT
    };
    cell.get_or_init(|| {
        jsonschema::options()
            .with_registry(schema_registry())
            .should_validate_formats(false)
            .build(&json!({ "$ref": schema }))
            .expect("the desk folder's schemas compile")
    })
}

/// A data folder entry: JSON state files parse, the rest are unchecked.
fn check_data_file(path: &Path) -> FileState {
    if path.is_dir() || path.extension().is_none_or(|x| x != "json") {
        return FileState::Unchecked;
    }
    match fs::read(path).map(|bytes| serde_json::from_slice::<Value>(&bytes)) {
        Ok(Ok(_)) => FileState::Valid,
        Ok(Err(e)) => FileState::Invalid(format!("line {}: not JSON: {e}", e.line())),
        Err(e) => FileState::Invalid(e.to_string()),
    }
}

/// A file's size, or the sum of a folder's files.
fn size_of(path: &Path) -> u64 {
    match fs::metadata(path) {
        Ok(meta) if meta.is_dir() => fs::read_dir(path)
            .map(|read| read.flatten().map(|e| size_of(&e.path())).sum())
            .unwrap_or(0),
        Ok(meta) => meta.len(),
        Err(_) => 0,
    }
}
