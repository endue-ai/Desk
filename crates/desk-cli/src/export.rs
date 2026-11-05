//! `desk export <dir|file.zip> [--with-data]` and `desk import <dir|file.zip> [--with-data]`: a desk
//! as files (ADR 0079). The export mirrors `~/.desk` (init.yaml, profiles/, keys.yaml, views/,
//! plugins.lock) with `desk.json { version, os, exportedAt }` at its root and, with `--with-data`,
//! the data files that are safe to carry under `data/` (`desk_core::DATA_FILES`). Import never
//! overwrites an existing init.yaml (it writes `init.yaml.imported` and says so), replaces the
//! other files of the same path, leaves the rest alone, refuses an export of a newer version, and
//! refuses data while a desk answers on its socket. Offline; exit codes 0 ok, 1 refused or failed.

use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::ExitCode;

use serde_json::{Value, json};

/// The export format this CLI writes and the newest it reads.
pub const VERSION: u64 = 0;
const MANIFEST: &str = "desk.json";

/// Files by their path in the export, with `/` separators.
type Tree = BTreeMap<String, Vec<u8>>;

pub fn export(target: &Path, with_data: bool, data: Option<PathBuf>) -> ExitCode {
    let (Some(home), Some(data)) = (home(), data.or_else(desk_ipc::data_dir)) else {
        return fail("desk export: no home folder; set HOME");
    };
    let desk = home.join(".desk");
    let mut tree = Tree::new();
    let manifest = json!({
        "version": VERSION,
        "os": os(),
        "exportedAt": desk_core::rfc3339_now(),
    });
    tree.insert(MANIFEST.to_owned(), pretty(&manifest));
    for rel in desk_core::desk_folder_files(&desk) {
        match fs::read(desk.join(&rel)) {
            Ok(bytes) => {
                tree.insert(slashed(&rel), bytes);
            }
            Err(e) => return fail(&format!("desk export: {}: {e}", desk.join(&rel).display())),
        }
    }
    if with_data {
        for name in desk_core::DATA_FILES {
            if let Ok(bytes) = fs::read(data.join(name)) {
                tree.insert(format!("data/{name}"), bytes);
            }
        }
    }
    let written = if is_zip(target) {
        write_zip(target, &tree)
    } else {
        write_dir(target, &tree)
    };
    match written {
        Ok(()) => {
            let files = tree.len() - 1;
            println!("exported {files} file(s) to {}", target.display());
            ExitCode::SUCCESS
        }
        Err(e) => fail(&format!("desk export: {}: {e}", target.display())),
    }
}

pub fn import(source: &Path, with_data: bool, data: Option<PathBuf>) -> ExitCode {
    let (Some(home), Some(data)) = (home(), data.or_else(desk_ipc::data_dir)) else {
        return fail("desk import: no home folder; set HOME");
    };
    let read = if is_zip(source) {
        read_zip(source)
    } else {
        read_dir(source)
    };
    let tree = match read {
        Ok(tree) => tree,
        Err(e) => return fail(&format!("desk import: {}: {e}", source.display())),
    };
    let Some(manifest) = tree
        .get(MANIFEST)
        .and_then(|bytes| serde_json::from_slice::<Value>(bytes).ok())
    else {
        return fail("desk import: no desk.json: this is not a desk export");
    };
    let version = manifest["version"].as_u64().unwrap_or(u64::MAX);
    if version > VERSION {
        return fail(&format!(
            "desk import: this export is version {version}; this desk reads version {VERSION} and older"
        ));
    }
    let carries_data = tree.keys().any(|path| path.starts_with("data/"));
    if with_data && carries_data && desk_answers() {
        return fail(
            "desk import: a desk is running on this computer; quit Desk first to import its data",
        );
    }
    let desk = home.join(".desk");
    let mut lines = Vec::new();
    for (path, bytes) in &tree {
        if path == MANIFEST {
            continue;
        }
        let Some(rel) = safe(path) else {
            lines.push(format!("skipped {path}: not a desk file"));
            continue;
        };
        let written = if let Some(name) = path.strip_prefix("data/") {
            if !with_data {
                lines.push(format!("skipped {path}: pass --with-data to import data"));
                continue;
            }
            if !desk_core::DATA_FILES.contains(&name) {
                lines.push(format!("skipped {path}: not a data file an export carries"));
                continue;
            }
            let bytes = if name == "brain.json" {
                transcript_only(bytes)
            } else {
                bytes.clone()
            };
            write(&data.join(name), &bytes)
        } else if !desk_file(path) {
            lines.push(format!("skipped {path}: not a desk file"));
            continue;
        } else if path == "init.yaml" && desk.join("init.yaml").exists() {
            let beside = desk.join("init.yaml.imported");
            lines.push(format!(
                "init.yaml exists: kept it, and wrote the export's as {}",
                beside.display()
            ));
            write(&beside, bytes)
        } else {
            write(&desk.join(rel), bytes)
        };
        if let Err(e) = written {
            return fail(&format!("desk import: {path}: {e}"));
        }
    }
    for line in lines {
        println!("{line}");
    }
    println!("imported {} into {}", source.display(), desk.display());
    ExitCode::SUCCESS
}

/// A desk folder file an export may carry: the single files and the YAML files of the folders.
fn desk_file(path: &str) -> bool {
    desk_core::DESK_FILES.contains(&path)
        || desk_core::DESK_FOLDERS.iter().any(|folder| {
            path.strip_prefix(folder)
                .and_then(|rest| rest.strip_prefix('/'))
                .is_some_and(|name| !name.contains('/') && name.ends_with(".yaml"))
        })
}

/// A relative path that stays inside the folder it is written into.
fn safe(path: &str) -> Option<PathBuf> {
    let rel = PathBuf::from(path);
    rel.components()
        .all(|c| matches!(c, Component::Normal(_)))
        .then_some(rel)
}

/// brain.json keeps its transcript only: the new desk makes its own desk id and brain session.
fn transcript_only(bytes: &[u8]) -> Vec<u8> {
    let saved: Value = serde_json::from_slice(bytes).unwrap_or(Value::Null);
    let transcript = saved.get("transcript").cloned().unwrap_or(json!([]));
    pretty(&json!({ "deskId": "", "transcript": transcript }))
}

/// Whether a desk answers on its socket now.
fn desk_answers() -> bool {
    desk_ipc::socket_path().is_some_and(|path| desk_ipc::Client::connect(&path).is_ok())
}

fn write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, bytes)
}

fn write_dir(target: &Path, tree: &Tree) -> io::Result<()> {
    if fs::read_dir(target).is_ok_and(|mut entries| entries.next().is_some()) {
        return Err(io::Error::other(
            "the folder is not empty; export into a new one",
        ));
    }
    for (path, bytes) in tree {
        write(&target.join(path), bytes)?;
    }
    Ok(())
}

fn read_dir(source: &Path) -> io::Result<Tree> {
    let mut tree = Tree::new();
    let mut stack = vec![PathBuf::new()];
    while let Some(rel) = stack.pop() {
        for entry in fs::read_dir(source.join(&rel))? {
            let entry = entry?;
            let next = rel.join(entry.file_name());
            if entry.file_type()?.is_dir() {
                stack.push(next);
            } else {
                tree.insert(slashed(&next), fs::read(entry.path())?);
            }
        }
    }
    Ok(tree)
}

fn write_zip(target: &Path, tree: &Tree) -> io::Result<()> {
    if let Some(parent) = target.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent)?;
    }
    let mut zip = zip::ZipWriter::new(fs::File::create(target)?);
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for (path, bytes) in tree {
        zip.start_file(path.as_str(), options)
            .map_err(io::Error::other)?;
        zip.write_all(bytes)?;
    }
    zip.finish().map_err(io::Error::other)?;
    Ok(())
}

/// Stored and deflated entries, so a zip re-made by Finder or `zip` imports too.
fn read_zip(source: &Path) -> io::Result<Tree> {
    let mut archive = zip::ZipArchive::new(fs::File::open(source)?).map_err(io::Error::other)?;
    let mut tree = Tree::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(io::Error::other)?;
        if file.is_dir() {
            continue;
        }
        let name = file
            .name()
            .map_err(io::Error::other)?
            .trim_start_matches("./")
            .to_owned();
        // Finder adds __MACOSX/ beside the files.
        if name.starts_with("__MACOSX/") {
            continue;
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        tree.insert(name, bytes);
    }
    // A zip of the folder (export/desk.json) rather than of its files: drop the one top folder.
    if !tree.contains_key(MANIFEST)
        && let Some(top) = tree
            .keys()
            .find(|k| k.ends_with(&format!("/{MANIFEST}")) && k.matches('/').count() == 1)
            .map(|k| k.trim_end_matches(MANIFEST).to_owned())
    {
        tree = tree
            .into_iter()
            .filter_map(|(k, v)| k.strip_prefix(&top).map(|rest| (rest.to_owned(), v)))
            .collect();
    }
    Ok(tree)
}

fn is_zip(path: &Path) -> bool {
    path.extension()
        .is_some_and(|x| x.eq_ignore_ascii_case("zip"))
}

fn slashed(path: &Path) -> String {
    path.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn pretty(value: &Value) -> Vec<u8> {
    let mut text = serde_json::to_string_pretty(value).unwrap_or_default();
    text.push('\n');
    text.into_bytes()
}

fn os() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        _ => "linux",
    }
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn fail(line: &str) -> ExitCode {
    eprintln!("{line}");
    ExitCode::from(1)
}
