//! `desk doctor` (ADR 0061, #288): what the desk's files say, without a running desk. It lists the
//! plugins the runtime quarantined (`desk`'s store key `plugins.quarantined` in store.json), every
//! `.broken` state file in the data folder and in `~/.desk/views`, then every file of the desk
//! folder and the data folder with who writes it, its size and whether it reads as its spec says
//! (`desk_core::desk_files`), and how many crash reports `crashes/` holds with the newest one's time
//! and kind (#322); `--last-crash` prints that report. It only reads, never the socket, so it works
//! after a crash; it exits 1 when a file is invalid or `--data` names no folder, 0 otherwise. A
//! default data folder that is not there yet is a desk that never ran, and says so.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use desk_core::{DeskFile, FileState};
use serde_json::{Value, json};

pub fn run(data: Option<PathBuf>, json: bool) -> ExitCode {
    let Some(data) = folder(data, json) else {
        return ExitCode::from(1);
    };
    let quarantined = quarantined(&data);
    let mut broken = desk_core::broken_in(&data);
    let home = home();
    if let Some(home) = &home {
        broken.extend(desk_core::broken_in(&home.join(".desk").join("views")));
    }
    let files: Vec<DeskFile> = home
        .as_deref()
        .map(|home| desk_core::desk_files(home, &data))
        .unwrap_or_default();
    let invalid = files
        .iter()
        .any(|f| matches!(f.state, FileState::Invalid(_)));
    let crashes = desk_crash::Crashes::in_data(&data);
    let newest = crashes
        .newest()
        .map(|(_, report)| json!({ "at": report["at"], "kind": report["kind"] }));
    if json {
        let broken: Vec<String> = broken.iter().map(|p| p.display().to_string()).collect();
        let files: Vec<Value> = files
            .iter()
            .map(|f| {
                json!({
                    "path": f.path.display().to_string(),
                    "owner": f.owner.as_str(),
                    "size": f.size,
                    "state": f.state.label(),
                })
            })
            .collect();
        let mut answer = json!({ "quarantined": quarantined, "broken": broken, "files": files });
        // Only a desk that crashed says so, so the answer of one that did not stays as it was.
        if let Some(newest) = newest {
            answer["crashes"] = json!({ "count": crashes.count(), "newest": newest });
        }
        println!("{answer}");
    } else {
        if !data.is_dir() {
            let never = "no desk has run as this user";
            println!("ok: no data folder at {} yet ({never})", data.display());
        } else if quarantined.is_empty() && broken.is_empty() {
            println!(
                "ok: nothing quarantined, no broken state files in {}",
                data.display()
            );
        }
        for entry in &quarantined {
            let field = |name: &str| entry[name].as_str().unwrap_or("").to_owned();
            println!(
                "quarantined\t{}\t{}\t{}",
                field("id"),
                field("version"),
                field("at")
            );
        }
        for path in &broken {
            println!("broken\t{}", path.display());
        }
        if let Some(newest) = &newest {
            let field = |name: &str| newest[name].as_str().unwrap_or("").to_owned();
            let count = crashes.count();
            println!("crashes\t{count}\t{}\t{}", field("at"), field("kind"));
        }
        for file in &files {
            println!(
                "file\t{}\t{}\t{}\t{}",
                file.path.display(),
                file.owner.as_str(),
                file.size,
                file.state.label()
            );
        }
    }
    if invalid {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

/// `desk doctor --last-crash`: the newest crash report, indented, or the file as it is with `--json`;
/// a desk that never crashed says so and exits 0.
pub fn last_crash(data: Option<PathBuf>, json: bool) -> ExitCode {
    let Some(data) = folder(data, json) else {
        return ExitCode::from(1);
    };
    let crashes = desk_crash::Crashes::in_data(&data);
    match crashes.newest() {
        Some((path, report)) if json => match std::fs::read_to_string(&path) {
            Ok(text) => print!("{text}"),
            Err(_) => println!("{report}"),
        },
        Some((path, report)) => {
            println!("{}", path.display());
            println!(
                "{}",
                serde_json::to_string_pretty(&report).unwrap_or_default()
            );
        }
        None => println!("no crash reports in {}", crashes.dir().display()),
    }
    ExitCode::SUCCESS
}

/// The data folder to read: the one `--data` names, which must be a folder, or the desk's own,
/// which may not be there yet. `None`, said on stderr (or as a JSON line with `--json`), when
/// there is none.
fn folder(named: Option<PathBuf>, json: bool) -> Option<PathBuf> {
    let why = match named {
        Some(dir) if dir.is_dir() => return Some(dir),
        Some(dir) if dir.exists() => format!("--data {} is not a folder", dir.display()),
        Some(dir) => format!("--data {}: no such folder", dir.display()),
        None => match desk_ipc::data_dir() {
            Some(dir) => return Some(dir),
            None => "no data folder (no home); pass --data <dir>".to_owned(),
        },
    };
    if json {
        let error = json!({ "code": "not_found", "message": why });
        println!("{}", json!({ "ok": false, "error": error }));
    } else {
        eprintln!("desk doctor: {why}");
    }
    None
}

/// The entries of `plugins.quarantined` in the data folder's store.json; none when it cannot be read.
fn quarantined(data: &Path) -> Vec<Value> {
    std::fs::read(data.join("store.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|store| {
            store["desk"][desk_core::QUARANTINED_KEY]
                .as_array()
                .cloned()
        })
        .unwrap_or_default()
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}
