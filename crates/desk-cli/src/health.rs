//! `desk doctor` (ADR 0061): what the data folder says went wrong, without a running desk. It lists
//! the plugins the runtime quarantined (`desk`'s store key `plugins.quarantined` in store.json) and
//! every `.broken` state file in the data folder and in `~/.desk/views`. It only reads, and exits 0.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use serde_json::{Value, json};

pub fn run(data: Option<PathBuf>, json: bool) -> ExitCode {
    let Some(data) = data.or_else(desk_ipc::data_dir) else {
        eprintln!("desk doctor: no data folder (no home); pass --data <dir>");
        return ExitCode::from(1);
    };
    let quarantined = quarantined(&data);
    let mut broken = desk_core::broken_in(&data);
    if let Some(home) = home() {
        broken.extend(desk_core::broken_in(&home.join(".desk").join("views")));
    }
    if json {
        let broken: Vec<String> = broken.iter().map(|p| p.display().to_string()).collect();
        println!(
            "{}",
            json!({ "quarantined": quarantined, "broken": broken })
        );
    } else if quarantined.is_empty() && broken.is_empty() {
        println!(
            "ok: nothing quarantined, no broken state files in {}",
            data.display()
        );
    } else {
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
    }
    ExitCode::SUCCESS
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
