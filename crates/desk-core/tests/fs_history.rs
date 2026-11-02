//! The history fs.write keeps (ADR 0076): a write over a file whose bytes differ first keeps the old
//! bytes as a version (`history/objects/<sha256>`, indexed per path in
//! `history/paths/<sha256(absolute path)>.json`, the folder's real path), fs.history lists them and fs.restore writes one back
//! as a write of its own. The two desk.files settings bound it, and a broken index never stops the
//! core: it is set aside as `<name>.broken` with one warning.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use desk_bridge::{BridgeRequest, BridgeResponse, ErrorCode, Permission};
use desk_core::{Core, Roots};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

static COUNTER: AtomicU64 = AtomicU64::new(0);

const NOTES: &str = "example.notes";

/// A fresh home folder with `notes/a.md` ("# a\n") in it; the data folder is `home/.data`.
fn home() -> PathBuf {
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

fn history_dir(home: &Path) -> PathBuf {
    home.join(".data/history")
}

/// A core keeping its history under `home/.data/history`, with example.notes holding fs:read and
/// fs:write over `~/notes/**`.
fn core(home: &Path) -> Core {
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

fn grant(core: &Core, caller: &str, permission: Value) {
    let permission: Permission = serde_json::from_value(permission).unwrap();
    core.grant(caller, permission);
}

fn call(core: &Core, caller: &str, method: &str, params: Value) -> Result<Value, ErrorCode> {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params })).unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(err) => Err(err.error.code),
    }
}

fn write(core: &Core, path: &str, content: &str) -> Value {
    let scope = json!({ "permission": "fs:write", "paths": ["~/notes/**"] });
    let params = json!({ "path": path, "content": content, "scope": scope });
    call(core, NOTES, "fs.write", params).expect("fs.write")
}

fn history(
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

fn restore(core: &Core, caller: &str, path: &str, version: &str) -> Result<Value, ErrorCode> {
    let scope = json!({ "permission": "fs:write", "paths": ["~/notes/**"] });
    let params = json!({ "path": path, "version": version, "scope": scope });
    call(core, caller, "fs.restore", params)
}

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The path a history names `file` by: its folder's real path (no symlinks) and its name.
fn real(file: &Path) -> PathBuf {
    let folder = fs::canonicalize(file.parent().unwrap()).unwrap();
    folder.join(file.file_name().unwrap())
}

/// Where the index of `file` (an absolute path) lives.
fn index_of(home: &Path, file: &Path) -> PathBuf {
    let key = sha256(real(file).to_string_lossy().as_bytes());
    history_dir(home).join("paths").join(format!("{key}.json"))
}

fn blob(home: &Path, sha: &str) -> PathBuf {
    history_dir(home).join("objects").join(sha)
}

fn shas(versions: &[Value]) -> Vec<String> {
    versions
        .iter()
        .map(|v| v["sha256"].as_str().unwrap().to_owned())
        .collect()
}

/// Set one of desk.files' settings as its owner does.
fn setting(core: &Core, key: &str, value: Value) {
    call(
        core,
        "desk.files",
        "settings.set",
        json!({ "key": key, "value": value }),
    )
    .unwrap();
}

fn is_version_id(id: &str) -> bool {
    let Some((millis, hex)) = id.split_once('-') else {
        return false;
    };
    !millis.is_empty()
        && millis.bytes().all(|b| b.is_ascii_digit())
        && hex.len() == 6
        && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

#[test]
fn a_write_over_a_file_keeps_its_old_bytes_as_one_version() {
    let home = home();
    let core = core(&home);
    let written = write(&core, "~/notes/a.md", "# b\n");
    assert_eq!(written["bytesWritten"], 4);
    let id = written["version"]
        .as_str()
        .expect("the write names its version");
    assert!(is_version_id(id), "{id}");
    assert_eq!(
        fs::read_to_string(home.join("notes/a.md")).unwrap(),
        "# b\n"
    );

    let versions = history(&core, NOTES, "~/notes/a.md", None).unwrap();
    assert_eq!(versions.len(), 1);
    let version = &versions[0];
    assert_eq!(version["id"], id);
    assert_eq!(version["caller"], NOTES);
    assert_eq!(version["size"], 4);
    assert_eq!(version["sha256"], sha256(b"# a\n"));
    assert!(version["at"].as_str().unwrap().ends_with('Z'));

    assert_eq!(fs::read(blob(&home, &sha256(b"# a\n"))).unwrap(), b"# a\n");
    let file = home.join("notes/a.md");
    let index: Value = serde_json::from_slice(&fs::read(index_of(&home, &file)).unwrap()).unwrap();
    assert_eq!(index["version"], 1);
    assert_eq!(index["path"], real(&file).to_string_lossy().as_ref());
    assert_eq!(index["versions"].as_array().unwrap().len(), 1);
    assert_eq!(index["versions"][0]["id"], id);
}

#[test]
fn a_new_file_and_unchanged_bytes_record_no_version() {
    let home = home();
    let core = core(&home);
    let created = write(&core, "~/notes/new.md", "fresh");
    assert!(created.get("version").is_none(), "{created}");
    assert!(
        history(&core, NOTES, "~/notes/new.md", None)
            .unwrap()
            .is_empty()
    );

    let same = write(&core, "~/notes/a.md", "# a\n");
    assert!(same.get("version").is_none(), "{same}");
    assert!(
        history(&core, NOTES, "~/notes/a.md", None)
            .unwrap()
            .is_empty()
    );
    assert!(!blob(&home, &sha256(b"# a\n")).exists());
}

#[test]
fn history_lists_newest_first_and_honours_limit() {
    let home = home();
    let core = core(&home);
    for content in ["# b\n", "# c\n", "# d\n"] {
        write(&core, "~/notes/a.md", content);
    }
    let all = history(&core, NOTES, "~/notes/a.md", None).unwrap();
    let expected: Vec<String> = ["# c\n", "# b\n", "# a\n"]
        .iter()
        .map(|c| sha256(c.as_bytes()))
        .collect();
    assert_eq!(shas(&all), expected);
    let newest = history(&core, NOTES, "~/notes/a.md", Some(2)).unwrap();
    assert_eq!(shas(&newest), expected[..2]);
    // The same file named by its absolute path has the same history.
    let absolute = home.join("notes/a.md").to_string_lossy().into_owned();
    grant(
        &core,
        "example.abs",
        json!({ "permission": "fs:read", "paths": ["/**"] }),
    );
    let params =
        json!({ "path": absolute, "scope": { "permission": "fs:read", "paths": ["/**"] } });
    let result = call(&core, "example.abs", "fs.history", params).unwrap();
    assert_eq!(result["versions"].as_array().unwrap().len(), 3);
}

#[test]
fn history_needs_fs_read_and_restore_needs_fs_write() {
    let home = home();
    let core = core(&home);
    let id = write(&core, "~/notes/a.md", "# b\n")["version"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        history(&core, "example.other", "~/notes/a.md", None),
        Err(ErrorCode::PermissionDenied)
    );
    grant(
        &core,
        "example.reader",
        json!({ "permission": "fs:read", "paths": ["~/notes/**"] }),
    );
    assert_eq!(
        history(&core, "example.reader", "~/notes/a.md", None)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        restore(&core, "example.reader", "~/notes/a.md", &id),
        Err(ErrorCode::PermissionDenied)
    );
    assert_eq!(
        fs::read_to_string(home.join("notes/a.md")).unwrap(),
        "# b\n"
    );
}

#[test]
fn restore_puts_the_old_bytes_back_and_records_the_replaced_ones() {
    let home = home();
    let core = core(&home);
    let first = write(&core, "~/notes/a.md", "# b\n")["version"]
        .as_str()
        .unwrap()
        .to_owned();
    grant(
        &core,
        "example.undo",
        json!({ "permission": "fs:write", "paths": ["~/notes/**"] }),
    );
    let restored = restore(&core, "example.undo", "~/notes/a.md", &first).unwrap();
    assert_eq!(restored["bytesWritten"], 4);
    assert_eq!(
        fs::read_to_string(home.join("notes/a.md")).unwrap(),
        "# a\n"
    );

    let versions = history(&core, NOTES, "~/notes/a.md", None).unwrap();
    assert_eq!(versions.len(), 2);
    assert_eq!(versions[0]["id"], restored["version"]);
    assert_eq!(versions[0]["sha256"], sha256(b"# b\n"));
    assert_eq!(versions[0]["caller"], "example.undo");
    assert_eq!(versions[1]["id"], first.as_str());
}

#[test]
fn restore_of_an_unknown_version_is_not_found() {
    let home = home();
    let core = core(&home);
    write(&core, "~/notes/a.md", "# b\n");
    assert_eq!(
        restore(&core, NOTES, "~/notes/a.md", "1-abcdef"),
        Err(ErrorCode::NotFound)
    );
    // A version of another file is not this file's.
    fs::write(home.join("notes/z.md"), "zz").unwrap();
    let other = write(&core, "~/notes/z.md", "yy")["version"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        restore(&core, NOTES, "~/notes/a.md", &other),
        Err(ErrorCode::NotFound)
    );
    assert_eq!(
        fs::read_to_string(home.join("notes/a.md")).unwrap(),
        "# b\n"
    );
}

#[test]
fn restore_of_a_damaged_version_is_an_io_error_and_writes_nothing() {
    let home = home();
    let core = core(&home);
    let id = write(&core, "~/notes/a.md", "# b\n")["version"]
        .as_str()
        .unwrap()
        .to_owned();
    fs::write(blob(&home, &sha256(b"# a\n")), "tampered").unwrap();
    assert_eq!(
        restore(&core, NOTES, "~/notes/a.md", &id),
        Err(ErrorCode::IoError)
    );
    assert_eq!(
        fs::read_to_string(home.join("notes/a.md")).unwrap(),
        "# b\n"
    );
}

#[test]
fn versions_beyond_max_versions_are_pruned_oldest_first() {
    let home = home();
    let init = home.join(".desk/init.yaml");
    fs::create_dir_all(init.parent().unwrap()).unwrap();
    fs::write(&init, "settings:\n  desk.files.history-max-versions: 2\n").unwrap();
    let core = core(&home).with_init_file(init);
    for content in ["# b\n", "# c\n", "# d\n"] {
        write(&core, "~/notes/a.md", content);
    }
    let versions = history(&core, NOTES, "~/notes/a.md", None).unwrap();
    assert_eq!(shas(&versions), [sha256(b"# c\n"), sha256(b"# b\n")]);
    assert!(!blob(&home, &sha256(b"# a\n")).exists());
}

#[test]
fn bytes_beyond_max_bytes_prune_the_oldest_and_shared_blobs_stay_while_named() {
    let home = home();
    let core = core(&home);
    // Two files with the same bytes share one blob; it stays while either index names it.
    setting(&core, "history-max-versions", json!(1));
    fs::write(home.join("notes/x.md"), "AAAAAA").unwrap();
    fs::write(home.join("notes/z.md"), "AAAAAA").unwrap();
    write(&core, "~/notes/x.md", "BBBBBB");
    write(&core, "~/notes/z.md", "CCCCCC");
    let shared = blob(&home, &sha256(b"AAAAAA"));
    assert!(shared.exists());
    write(&core, "~/notes/x.md", "DDDDDD");
    assert_eq!(
        shas(&history(&core, NOTES, "~/notes/x.md", None).unwrap()),
        [sha256(b"BBBBBB")]
    );
    assert!(shared.exists(), "z.md still names the shared blob");
    write(&core, "~/notes/z.md", "EEEEEE");
    assert!(!shared.exists(), "no index names it any more");

    // Over the byte budget, the oldest version desk-wide goes first.
    setting(&core, "history-max-versions", json!(50));
    setting(&core, "history-max-bytes", json!(12));
    fs::write(home.join("notes/y.md"), "QQQQ").unwrap();
    write(&core, "~/notes/y.md", "RRRR");
    assert!(
        history(&core, NOTES, "~/notes/x.md", None)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        shas(&history(&core, NOTES, "~/notes/z.md", None).unwrap()),
        [sha256(b"CCCCCC")]
    );
    assert_eq!(
        shas(&history(&core, NOTES, "~/notes/y.md", None).unwrap()),
        [sha256(b"QQQQ")]
    );
    assert!(!blob(&home, &sha256(b"BBBBBB")).exists());
}

#[test]
fn a_corrupt_index_starts_empty_keeps_a_broken_copy_and_warns_once() {
    let home = home();
    write(&core(&home), "~/notes/a.md", "# b\n");
    let index = index_of(&home, &home.join("notes/a.md"));
    fs::write(&index, "{ not json").unwrap();

    let core = core(&home);
    assert!(
        history(&core, NOTES, "~/notes/a.md", None)
            .unwrap()
            .is_empty()
    );
    let broken = index.with_file_name(format!(
        "{}.broken",
        index.file_name().unwrap().to_string_lossy()
    ));
    assert_eq!(fs::read_to_string(&broken).unwrap(), "{ not json");
    assert!(!index.exists());

    grant(&core, "example.logs", json!({ "permission": "log:read" }));
    let tail = call(
        &core,
        "example.logs",
        "log.tail",
        json!({ "channel": "core", "scope": { "permission": "log:read" } }),
    )
    .unwrap();
    let warnings: Vec<&Value> = tail["entries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["level"] == "warn")
        .collect();
    assert_eq!(warnings.len(), 1, "{tail}");
    assert!(warnings[0]["message"].as_str().unwrap().contains(".broken"));

    // The history goes on from empty.
    write(&core, "~/notes/a.md", "# c\n");
    assert_eq!(
        history(&core, NOTES, "~/notes/a.md", None).unwrap().len(),
        1
    );
}

#[test]
fn a_missing_history_folder_starts_empty_and_is_created_on_the_first_write() {
    let home = home();
    let core = core(&home);
    assert!(!history_dir(&home).exists());
    assert!(
        history(&core, NOTES, "~/notes/a.md", None)
            .unwrap()
            .is_empty()
    );
    write(&core, "~/notes/a.md", "# b\n");
    assert!(index_of(&home, &home.join("notes/a.md")).exists());
}

#[test]
fn a_core_without_a_history_folder_keeps_nothing() {
    let home = home();
    let core = Core::new(Roots { home: home.clone() });
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
    let written = write(&core, "~/notes/a.md", "# b\n");
    assert!(written.get("version").is_none());
    assert!(
        history(&core, NOTES, "~/notes/a.md", None)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        restore(&core, NOTES, "~/notes/a.md", "1-abcdef"),
        Err(ErrorCode::NotFound)
    );
}
