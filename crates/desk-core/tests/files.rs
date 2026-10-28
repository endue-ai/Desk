//! fs.write, fs.watch and the symlink rule, through Core::handle.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use desk_bridge::{BridgeEvent, BridgeRequest, BridgeResponse, ErrorCode};
use desk_core::{Core, Roots};
use serde_json::{Value, json};

fn temp_home() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("desk-files-{}-{nanos}", std::process::id()));
    fs::create_dir_all(dir.join("Documents")).unwrap();
    fs::create_dir_all(dir.join("Secret")).unwrap();
    fs::write(dir.join("Secret/key"), "hunter2").unwrap();
    dir
}

fn scope(kind: &str, paths: &[&str]) -> Value {
    json!({ "permission": kind, "paths": paths })
}

fn core_with(home: &Path, grants: &[Value]) -> Core {
    let core = Core::new(Roots {
        home: home.to_path_buf(),
    });
    for grant in grants {
        core.grant("desk", serde_json::from_value(grant.clone()).unwrap());
    }
    core
}

fn call(core: &Core, method: &str, params: Value) -> Result<Value, desk_bridge::BridgeError> {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params })).unwrap();
    match core.handle("desk", request) {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(err) => Err(err.error),
    }
}

#[test]
fn fs_write_creates_and_overwrites_inside_the_scope() {
    let home = temp_home();
    let write = scope("fs:write", &["~/Documents/**"]);
    let core = core_with(&home, std::slice::from_ref(&write));

    let written = call(
        &core,
        "fs.write",
        json!({ "path": "~/Documents/a.md", "content": "# A", "scope": write }),
    )
    .unwrap();
    assert_eq!(written, json!({ "bytesWritten": 3 }));
    call(
        &core,
        "fs.write",
        json!({ "path": "~/Documents/a.md", "content": "AAEC", "encoding": "base64", "scope": write }),
    )
    .unwrap();
    assert_eq!(
        fs::read(home.join("Documents/a.md")).unwrap(),
        vec![0u8, 1, 2]
    );
}

#[test]
fn fs_write_needs_fs_write_and_stays_inside_its_scope() {
    let home = temp_home();
    let read = scope("fs:read", &["~/Documents/**"]);
    let core = core_with(&home, std::slice::from_ref(&read));
    let write = scope("fs:write", &["~/Documents/**"]);
    let error = call(
        &core,
        "fs.write",
        json!({ "path": "~/Documents/a.md", "content": "x", "scope": write }),
    )
    .unwrap_err();
    assert_eq!(
        error.code,
        ErrorCode::PermissionDenied,
        "fs:read does not cover writing"
    );

    let core = core_with(&home, std::slice::from_ref(&write));
    let error = call(
        &core,
        "fs.write",
        json!({ "path": "~/Documents/../Secret/key", "content": "x", "scope": write }),
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    assert_eq!(
        fs::read_to_string(home.join("Secret/key")).unwrap(),
        "hunter2"
    );
}

#[test]
fn create_dirs_makes_parents_only_inside_the_scope() {
    let home = temp_home();
    let all = scope("fs:write", &["~/Documents/**"]);
    let core = core_with(&home, std::slice::from_ref(&all));
    let missing = call(
        &core,
        "fs.write",
        json!({ "path": "~/Documents/x/y/z.md", "content": "z", "scope": all }),
    )
    .unwrap_err();
    assert_eq!(missing.code, ErrorCode::NotFound, "without createDirs");
    call(
        &core,
        "fs.write",
        json!({ "path": "~/Documents/x/y/z.md", "content": "z", "createDirs": true, "scope": all }),
    )
    .unwrap();
    assert!(home.join("Documents/x/y/z.md").is_file());

    // Only markdown files are in this scope, so the folder for one is not.
    let md = scope("fs:write", &["~/Documents/**/*.md"]);
    let core = core_with(&home, std::slice::from_ref(&md));
    let error = call(
        &core,
        "fs.write",
        json!({ "path": "~/Documents/new/n.md", "content": "n", "createDirs": true, "scope": md }),
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    assert!(!home.join("Documents/new").exists());
}

#[cfg(unix)]
#[test]
fn a_symlink_below_the_grant_cannot_lead_out_of_it() {
    let home = temp_home();
    std::os::unix::fs::symlink(home.join("Secret"), home.join("Documents/link")).unwrap();
    let read = scope("fs:read", &["~/Documents/**"]);
    let write = scope("fs:write", &["~/Documents/**"]);
    let core = core_with(&home, &[read.clone(), write.clone()]);

    let error = call(
        &core,
        "fs.read",
        json!({ "path": "~/Documents/link/key", "scope": read }),
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    let error = call(
        &core,
        "fs.write",
        json!({ "path": "~/Documents/link/key", "content": "pwned", "scope": write }),
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    assert_eq!(
        fs::read_to_string(home.join("Secret/key")).unwrap(),
        "hunter2"
    );

    // Granting the link's own path is the person choosing it: that works.
    let through = scope("fs:read", &["~/Documents/link/**"]);
    let core = core_with(&home, std::slice::from_ref(&through));
    let content = call(
        &core,
        "fs.read",
        json!({ "path": "~/Documents/link/key", "scope": through }),
    )
    .unwrap();
    assert_eq!(content["content"], "hunter2");
}

/// The next fs.changed event for `path`, within five seconds.
fn changed(events: &Receiver<BridgeEvent>, path: &str) -> Option<Value> {
    changed_within(events, path, Duration::from_secs(5))
}

fn changed_within(events: &Receiver<BridgeEvent>, path: &str, wait: Duration) -> Option<Value> {
    let deadline = Instant::now() + wait;
    while Instant::now() < deadline {
        if let Ok(event) = events.recv_timeout(Duration::from_millis(100)) {
            let event = serde_json::to_value(event).unwrap();
            if event["event"] == "fs.changed" && event["data"]["path"] == path {
                return Some(event["data"].clone());
            }
        }
    }
    None
}

#[test]
fn fs_watch_reports_changes_with_bridge_paths() {
    let home = temp_home();
    let read = scope("fs:read", &["~/Documents/**"]);
    let core = core_with(&home, std::slice::from_ref(&read));
    let events = core.events().subscribe();
    fs::create_dir_all(home.join("Documents/sub")).unwrap();
    let watch = call(
        &core,
        "fs.watch",
        json!({ "path": "~/Documents", "recursive": true, "scope": read }),
    )
    .unwrap();
    let watch_id = watch["watchId"].as_str().unwrap().to_owned();

    fs::write(home.join("Documents/sub/n.md"), "n").unwrap();
    let data = changed(&events, "~/Documents/sub/n.md").expect("an fs.changed event");
    assert_eq!(data["watchId"], watch_id.as_str());
    assert!(["created", "modified"].contains(&data["change"].as_str().unwrap()));

    fs::remove_file(home.join("Documents/sub/n.md")).unwrap();
    let removed = std::iter::from_fn(|| changed(&events, "~/Documents/sub/n.md"))
        .any(|data| data["change"] == "removed");
    assert!(removed, "a removal follows");
}

#[test]
fn revoking_the_grant_ends_the_watch() {
    let home = temp_home();
    let read = scope("fs:read", &["~/Documents/**"]);
    let core = Core::new(Roots { home: home.clone() });
    let grant = core.grant("desk", serde_json::from_value(read.clone()).unwrap());
    let events = core.events().subscribe();
    call(
        &core,
        "fs.watch",
        json!({ "path": "~/Documents", "scope": read }),
    )
    .unwrap();

    fs::write(home.join("Documents/before.md"), "b").unwrap();
    assert!(changed(&events, "~/Documents/before.md").is_some());

    assert!(core.revoke("desk", &grant.grant_id));
    fs::write(home.join("Documents/after.md"), "a").unwrap();
    let after = changed_within(&events, "~/Documents/after.md", Duration::from_secs(1));
    assert!(after.is_none(), "no events after the revoke");
}
