//! fs.write and fs.watch through `Core::handle`: both pass the permission engine, writes land on
//! disk, and a watch reports changes as fs.changed events under the path the caller asked for until
//! its grant goes away.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use desk_bridge::{BridgeEvent, BridgeRequest, BridgeResponse, ErrorCode, Permission};
use desk_core::{Core, Roots};
use serde_json::{Value, json};

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// A fresh home folder with `notes/a.md` in it.
fn home() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("desk-fs-{}-{nanos}-{n}", std::process::id()));
    fs::create_dir_all(dir.join("notes")).unwrap();
    fs::write(dir.join("notes/a.md"), "# a\n").unwrap();
    dir
}

fn core(home: &Path) -> Core {
    Core::new(Roots {
        home: home.to_path_buf(),
    })
}

fn grant(core: &Core, caller: &str, permission: Value) -> String {
    let permission: Permission = serde_json::from_value(permission).unwrap();
    core.grant(caller, permission).grant_id
}

fn call(core: &Core, caller: &str, request: Value) -> Result<Value, ErrorCode> {
    let request: BridgeRequest = serde_json::from_value(request).unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(err) => Err(err.error.code),
    }
}

fn write(core: &Core, path: &str, content: &str, extra: Value) -> Result<Value, ErrorCode> {
    let mut params = json!({ "path": path, "content": content,
        "scope": { "permission": "fs:write", "paths": ["~/notes/**"] } });
    params
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().cloned().unwrap_or_default());
    call(
        core,
        "example.notes",
        json!({ "id": 1, "method": "fs.write", "params": params }),
    )
}

#[test]
fn fs_write_needs_a_grant_and_writes_inside_it() {
    let home = home();
    let core = core(&home);
    assert_eq!(
        write(&core, "~/notes/a.md", "x", json!({})),
        Err(ErrorCode::PermissionDenied)
    );
    grant(
        &core,
        "example.notes",
        json!({ "permission": "fs:write", "paths": ["~/notes/**"] }),
    );
    assert_eq!(
        write(&core, "~/notes/a.md", "# b\n", json!({})),
        Ok(json!({ "bytesWritten": 4 }))
    );
    assert_eq!(
        fs::read_to_string(home.join("notes/a.md")).unwrap(),
        "# b\n"
    );
    assert_eq!(
        write(
            &core,
            "~/notes/bin",
            "AAEC",
            json!({ "encoding": "base64" })
        ),
        Ok(json!({ "bytesWritten": 3 }))
    );
    assert_eq!(fs::read(home.join("notes/bin")).unwrap(), vec![0u8, 1, 2]);
    assert_eq!(
        write(&core, "~/other.md", "x", json!({})),
        Err(ErrorCode::PermissionDenied)
    );
}

#[test]
fn fs_write_creates_folders_only_when_asked() {
    let home = home();
    let core = core(&home);
    grant(
        &core,
        "example.notes",
        json!({ "permission": "fs:write", "paths": ["~/notes/**"] }),
    );
    assert_eq!(
        write(&core, "~/notes/2026/10/c.md", "c", json!({})),
        Err(ErrorCode::NotFound)
    );
    assert_eq!(
        write(
            &core,
            "~/notes/2026/10/c.md",
            "c",
            json!({ "createDirs": true })
        ),
        Ok(json!({ "bytesWritten": 1 }))
    );
    assert_eq!(
        fs::read_to_string(home.join("notes/2026/10/c.md")).unwrap(),
        "c"
    );
}

/// The first fs.changed event for `path`, within a few seconds.
fn changed(events: &std::sync::mpsc::Receiver<BridgeEvent>, path: &str) -> Option<Value> {
    let deadline = Instant::now() + Duration::from_secs(5);
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        let Ok(event) = events.recv_timeout(left) else {
            break;
        };
        let value = serde_json::to_value(&event).unwrap();
        if value["event"] == "fs.changed" && value["data"]["path"] == path {
            return Some(value["data"].clone());
        }
    }
    None
}

#[test]
fn fs_watch_reports_changes_under_the_watched_path_until_the_grant_is_revoked() {
    let home = home();
    let core = core(&home);
    let watch = json!({ "id": 2, "method": "fs.watch",
        "params": { "path": "~/notes", "scope": { "permission": "fs:read", "paths": ["~/notes/**", "~/notes"] } } });
    assert_eq!(
        call(&core, "example.notes", watch.clone()),
        Err(ErrorCode::PermissionDenied)
    );
    let grant_id = grant(
        &core,
        "example.notes",
        json!({ "permission": "fs:read", "paths": ["~/notes/**", "~/notes"] }),
    );
    let events = core.events().subscribe();
    let started = call(&core, "example.notes", watch).unwrap();
    let watch_id = started["watchId"].as_str().unwrap().to_owned();
    assert_eq!(core.watch_count(), 1);

    fs::write(home.join("notes/b.md"), "new").unwrap();
    let data = changed(&events, "~/notes/b.md").expect("a change under the watch is reported");
    assert_eq!(data["watchId"], json!(watch_id));
    assert!(
        ["created", "modified"].contains(&data["change"].as_str().unwrap()),
        "{data}"
    );

    call(
        &core,
        "example.notes",
        json!({ "id": 3, "method": "perm.revoke", "params": { "grantId": grant_id } }),
    )
    .unwrap();
    assert_eq!(core.watch_count(), 0, "a revoked grant ends its watches");
}
