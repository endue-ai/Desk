//! What the fs operation tests share (#553): a home with `work/` (the caller's scope) and `other/`
//! (outside it), a core whose trash is a folder of the home (`.test-trash`), never the OS trash of
//! whoever runs the tests, and the bridge calls.
#![allow(dead_code)]

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use desk_bridge::{BridgeRequest, BridgeResponse, ErrorCode, Permission};
use desk_core::{Core, Roots};
use serde_json::{Value, json};

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// The caller the tests act as: fs:read and fs:write over `~/work/**`.
pub const FILES: &str = "example.files";
/// The runtime: cmd:invoke over every command, for cmd.undo and cmd.redo.
pub const DESK: &str = "desk";

/// A fresh home: `work/a.txt` ("alpha"), `work/docs/b.md` ("bravo") and `other/secret.txt`.
pub fn home() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("desk-fsops-{}-{nanos}-{n}", std::process::id()));
    fs::create_dir_all(dir.join("work/docs")).unwrap();
    fs::create_dir_all(dir.join("other")).unwrap();
    fs::write(dir.join("work/a.txt"), "alpha").unwrap();
    fs::write(dir.join("work/docs/b.md"), "bravo").unwrap();
    fs::write(dir.join("other/secret.txt"), "secret").unwrap();
    dir
}

/// The trash the core is given: moves each path into `<home>/.test-trash/<n>-<name>` and records
/// it, or refuses as an OS without a trash would while `refuse` is set.
#[derive(Clone, Default)]
pub struct TestTrash {
    pub trashed: Arc<Mutex<Vec<PathBuf>>>,
    pub refuse: Arc<AtomicBool>,
}

impl TestTrash {
    /// The original paths moved to the trash, oldest first.
    pub fn trashed(&self) -> Vec<PathBuf> {
        self.trashed.lock().unwrap().clone()
    }
}

/// A core over `home` with a history, the test trash, FILES' grants and DESK's cmd:invoke.
pub fn core(home: &Path) -> (Core, TestTrash) {
    let trash = TestTrash::default();
    let bin = home.join(".test-trash");
    let seen = trash.clone();
    let core = Core::new(Roots {
        home: home.to_path_buf(),
    })
    .with_history_dir(home.join(".data/history"))
    .with_trash(move |path: &Path| {
        if seen.refuse.load(Ordering::SeqCst) {
            return Err(io::Error::other("there is no trash on this volume"));
        }
        fs::symlink_metadata(path)?;
        fs::create_dir_all(&bin)?;
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let name = path.file_name().unwrap().to_string_lossy();
        fs::rename(path, bin.join(format!("{n}-{name}")))?;
        seen.trashed.lock().unwrap().push(path.to_path_buf());
        Ok(())
    });
    grant(&core, FILES, read(&["~/work/**"]));
    grant(&core, FILES, write(&["~/work/**"]));
    grant(
        &core,
        DESK,
        json!({ "permission": "cmd:invoke", "ids": ["*"] }),
    );
    (core, trash)
}

pub fn read(paths: &[&str]) -> Value {
    json!({ "permission": "fs:read", "paths": paths })
}

pub fn write(paths: &[&str]) -> Value {
    json!({ "permission": "fs:write", "paths": paths })
}

pub fn grant(core: &Core, caller: &str, permission: Value) {
    let permission: Permission = serde_json::from_value(permission).unwrap();
    core.grant(caller, permission);
}

pub fn call(core: &Core, caller: &str, method: &str, params: Value) -> Result<Value, ErrorCode> {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params }))
            .unwrap_or_else(|e| panic!("{method} {params}: {e}"));
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(err) => Err(err.error.code),
    }
}

/// FILES' calls, each under its `~/work/**` scopes.
pub fn stat(core: &Core, path: &str) -> Result<Value, ErrorCode> {
    let params = json!({ "path": path, "scope": read(&["~/work/**"]) });
    call(core, FILES, "fs.stat", params)
}

pub fn mkdir(core: &Core, path: &str, parents: bool) -> Result<Value, ErrorCode> {
    let params = json!({ "path": path, "parents": parents, "scope": write(&["~/work/**"]) });
    call(core, FILES, "fs.mkdir", params)
}

pub fn rename(core: &Core, from: &str, to: &str) -> Result<Value, ErrorCode> {
    let params = json!({ "from": from, "to": to, "scope": write(&["~/work/**"]) });
    call(core, FILES, "fs.rename", params)
}

pub fn copy(core: &Core, from: &str, to: &str) -> Result<Value, ErrorCode> {
    let params = json!({ "from": from, "to": to,
        "scope": write(&["~/work/**"]), "fromScope": read(&["~/work/**"]) });
    call(core, FILES, "fs.copy", params)
}

pub fn trash(core: &Core, path: &str) -> Result<Value, ErrorCode> {
    let params = json!({ "path": path, "scope": write(&["~/work/**"]) });
    call(core, FILES, "fs.trash", params)
}

pub fn undo(core: &Core) -> Result<Value, ErrorCode> {
    let scope = json!({ "permission": "cmd:invoke", "ids": ["*"] });
    call(core, DESK, "cmd.undo", json!({ "scope": scope }))
}

pub fn redo(core: &Core) -> Result<Value, ErrorCode> {
    let scope = json!({ "permission": "cmd:invoke", "ids": ["*"] });
    call(core, DESK, "cmd.redo", json!({ "scope": scope }))
}

pub fn text(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// The names in a folder, sorted.
pub fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}
