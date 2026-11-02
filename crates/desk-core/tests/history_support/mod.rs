//! What the history tests share (ADR 0076): a home with `notes/a.md`, a core that keeps its history
//! under `home/.data/history`, the bridge calls, and where the history's files are.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use desk_bridge::{BridgeRequest, BridgeResponse, ErrorCode, Permission};
use desk_core::{Core, Roots};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

static COUNTER: AtomicU64 = AtomicU64::new(0);

pub const NOTES: &str = "example.notes";

/// A fresh home folder with `notes/a.md` ("# a\n") in it; the data folder is `home/.data`.
pub fn home() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("desk-hist-{}-{nanos}-{n}", std::process::id()));
    fs::create_dir_all(dir.join("notes")).unwrap();
    fs::write(dir.join("notes/a.md"), "# a\n").unwrap();
    dir
}

pub fn history_dir(home: &Path) -> PathBuf {
    home.join(".data/history")
}

/// A core keeping its history under `home/.data/history`, with example.notes holding fs:read and
/// fs:write over `~/notes/**`.
pub fn core(home: &Path) -> Core {
    let core = Core::new(Roots {
        home: home.to_path_buf(),
    })
    .with_history_dir(history_dir(home));
    grant(
        &core,
        NOTES,
        json!({ "permission": "fs:read", "paths": ["~/notes/**"] }),
    );
    grant(
        &core,
        NOTES,
        json!({ "permission": "fs:write", "paths": ["~/notes/**"] }),
    );
    core
}

pub fn grant(core: &Core, caller: &str, permission: Value) {
    let permission: Permission = serde_json::from_value(permission).unwrap();
    core.grant(caller, permission);
}

pub fn call(core: &Core, caller: &str, method: &str, params: Value) -> Result<Value, ErrorCode> {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params })).unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(err) => Err(err.error.code),
    }
}

pub fn write(core: &Core, path: &str, content: &str) -> Value {
    let scope = json!({ "permission": "fs:write", "paths": ["~/notes/**"] });
    let params = json!({ "path": path, "content": content, "scope": scope });
    call(core, NOTES, "fs.write", params).expect("fs.write")
}

pub fn history(
    core: &Core,
    caller: &str,
    path: &str,
    limit: Option<u64>,
) -> Result<Vec<Value>, ErrorCode> {
    let mut params = json!({ "path": path,
        "scope": { "permission": "fs:read", "paths": ["~/notes/**"] } });
    if let Some(limit) = limit {
        params["limit"] = json!(limit);
    }
    let result = call(core, caller, "fs.history", params)?;
    Ok(result["versions"].as_array().expect("versions").clone())
}

pub fn restore(core: &Core, caller: &str, path: &str, version: &str) -> Result<Value, ErrorCode> {
    let scope = json!({ "permission": "fs:write", "paths": ["~/notes/**"] });
    let params = json!({ "path": path, "version": version, "scope": scope });
    call(core, caller, "fs.restore", params)
}

pub fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The path a history names `file` by: its folder's real path (no symlinks) and its name.
pub fn real(file: &Path) -> PathBuf {
    let folder = fs::canonicalize(file.parent().unwrap()).unwrap();
    folder.join(file.file_name().unwrap())
}

/// Where the index of `file` (an absolute path) lives.
pub fn index_of(home: &Path, file: &Path) -> PathBuf {
    let key = sha256(real(file).to_string_lossy().as_bytes());
    history_dir(home).join("paths").join(format!("{key}.json"))
}

pub fn blob(home: &Path, sha: &str) -> PathBuf {
    history_dir(home).join("objects").join(sha)
}

pub fn shas(versions: &[Value]) -> Vec<String> {
    versions
        .iter()
        .map(|v| v["sha256"].as_str().unwrap().to_owned())
        .collect()
}

/// Set one of desk.files' settings as its owner does.
pub fn setting(core: &Core, key: &str, value: Value) {
    call(
        core,
        "desk.files",
        "settings.set",
        json!({ "key": key, "value": value }),
    )
    .unwrap();
}

pub fn is_version_id(id: &str) -> bool {
    let Some((millis, hex)) = id.split_once('-') else {
        return false;
    };
    !millis.is_empty()
        && millis.bytes().all(|b| b.is_ascii_digit())
        && hex.len() == 6
        && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}
