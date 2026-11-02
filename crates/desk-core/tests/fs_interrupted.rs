//! A write that dies half way (ADR 0076): fs.write puts the bytes in a temp file beside the target
//! and renames it over the target, so a process killed at any moment leaves the old file or the new
//! one, never a mix, and the history it kept still starts. The child half of the first test is this
//! binary run again with `DESK_INTERRUPT_HOME`: it writes until it is killed, every other round
//! without keeping versions (`DESK_INTERRUPT_BARE`), and the parent kills it when a temp file of its
//! write is on disk.

use std::collections::BTreeSet;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use desk_bridge::{BridgeRequest, BridgeResponse, ErrorCode, Permission};
use desk_core::{Core, Roots};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const HOME_ENV: &str = "DESK_INTERRUPT_HOME";
/// Set for the rounds whose child keeps no history.
const BARE_ENV: &str = "DESK_INTERRUPT_BARE";
/// What the child prints once its write loop runs.
const READY: &str = "desk-interrupt-ready";
const SIZE: usize = 1024 * 1024;
const ROUNDS: u64 = 8;

fn content(letter: char) -> String {
    letter.to_string().repeat(SIZE)
}

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn core(home: &Path) -> Core {
    let core = Core::new(Roots {
        home: home.to_path_buf(),
    })
    .with_history_dir(home.join(".data/history"));
    for permission in [
        json!({ "permission": "fs:read", "paths": ["~/big/**"] }),
        json!({ "permission": "fs:write", "paths": ["~/big/**"] }),
    ] {
        let permission: Permission = serde_json::from_value(permission).unwrap();
        core.grant("example.writer", permission);
    }
    core
}

fn call(core: &Core, method: &str, params: Value) -> Result<Value, ErrorCode> {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params })).unwrap();
    match core.handle("example.writer", request) {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(err) => Err(err.error.code),
    }
}

fn write(core: &Core, text: &str) -> Result<Value, ErrorCode> {
    let scope = json!({ "permission": "fs:write", "paths": ["~/big/**"] });
    call(
        core,
        "fs.write",
        json!({ "path": "~/big/file.txt", "content": text, "scope": scope }),
    )
}

/// A folder of its own for each test, also when two start in the same microsecond.
fn fresh_home() -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let n = NEXT.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("desk-kill-{}-{nanos}-{n}", std::process::id()));
    fs::create_dir_all(dir.join("big")).unwrap();
    dir
}

/// The child: write A and B in turn over one file until killed. Ignored, so that a plain test run
/// skips it; without `DESK_INTERRUPT_HOME` it returns at once.
#[test]
#[ignore = "the child process of a_write_killed_mid_way_leaves_the_old_or_the_new_file"]
fn child_writes_until_killed() {
    let Some(home) = std::env::var_os(HOME_ENV) else {
        return;
    };
    let core = core(Path::new(&home));
    if std::env::var_os(BARE_ENV).is_some_and(|bare| !bare.is_empty()) {
        // Keep nothing, so each turn of the loop is the temp file, its sync and the rename.
        let params = json!({ "key": "history-max-versions", "value": 0 });
        let request = json!({ "id": 1, "method": "settings.set", "params": params });
        core.handle("desk.files", serde_json::from_value(request).unwrap());
    }
    let (a, b) = (content('a'), content('b'));
    let mut ready = false;
    loop {
        for text in [&b, &a] {
            write(&core, text).expect("the child's write");
            if !ready {
                // The parent kills only once the loop runs.
                println!("{READY}");
                std::io::stdout().flush().unwrap();
                ready = true;
            }
        }
    }
}

/// Wait for the child's `READY` line, then kill it as soon as one of its temp files is in `dir`:
/// while the temp file is written and synced, before its rename. Kill it anyway after two seconds.
fn kill_mid_write(child: &mut Child, dir: &Path) {
    let stdout = child.stdout.take().expect("the child's stdout");
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if line.trim() == READY {
                let _ = tx.send(());
            }
        }
    });
    if rx.recv_timeout(Duration::from_secs(60)).is_ok() {
        let until = Instant::now() + Duration::from_secs(2);
        while Instant::now() < until && temps_in(dir) == 0 {
            std::thread::sleep(Duration::from_micros(200));
        }
    }
    child.kill().expect("SIGKILL");
    child.wait().unwrap();
}

/// How many temp files of killed writes `dir` holds.
fn temps_in(dir: &Path) -> usize {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| is_temp(&e.file_name().to_string_lossy()))
                .count()
        })
        .unwrap_or(0)
}

fn is_temp(name: &str) -> bool {
    name.starts_with('.') && name.ends_with(".tmp")
}

#[test]
fn a_write_killed_mid_way_leaves_the_old_or_the_new_file() {
    let home = fresh_home();
    let (a, b) = (content('a'), content('b'));
    fs::write(home.join("big/file.txt"), &a).unwrap();
    let whole = [sha256(a.as_bytes()), sha256(b.as_bytes())];
    let mut torn = 0;
    for round in 0..ROUNDS {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "child_writes_until_killed",
                "--ignored",
                "--nocapture",
            ])
            .env(HOME_ENV, &home)
            .env(BARE_ENV, if round % 2 == 1 { "1" } else { "" })
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("the child starts");
        kill_mid_write(&mut child, &home.join("big"));

        let on_disk = sha256(&fs::read(home.join("big/file.txt")).unwrap());
        assert!(
            whole.contains(&on_disk),
            "round {round}: the file is neither A nor B"
        );

        // The history it left starts, and every version it lists is whole.
        let core = core(&home);
        let scope = json!({ "permission": "fs:read", "paths": ["~/big/**"] });
        let listed = call(
            &core,
            "fs.history",
            json!({ "path": "~/big/file.txt", "scope": scope }),
        )
        .expect("fs.history after a kill");
        let kept: BTreeSet<&str> = listed["versions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|version| version["sha256"].as_str().unwrap())
            .collect();
        for sha in kept {
            assert!(
                whole.iter().any(|w| w == sha),
                "round {round}: a version is a mix"
            );
            let blob = home.join(".data/history/objects").join(sha);
            let blob = sha256(&fs::read(blob).unwrap());
            assert_eq!(blob, sha, "round {round}: a blob is torn");
        }
        torn += temp_files(&home.join("big"));
    }
    // Kills aimed at a temp file land between it and its rename: the case this is about.
    assert!(
        torn > 0,
        "no kill landed between a temp file and its rename"
    );
}

/// How many temp files killed writes left in `dir`; it removes them.
fn temp_files(dir: &Path) -> usize {
    let mut count = 0;
    for entry in fs::read_dir(dir).unwrap().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_temp(&name) {
            fs::remove_file(entry.path()).unwrap();
            count += 1;
        }
    }
    count
}

#[test]
fn a_temp_file_left_behind_changes_neither_the_file_nor_the_next_write() {
    let home = fresh_home();
    fs::write(home.join("big/file.txt"), "old").unwrap();
    // What a write killed between its temp file and the rename leaves beside the target.
    fs::write(home.join("big/.file.txt.desk-999-0.tmp"), "half of the n").unwrap();
    let core = core(&home);
    assert_eq!(
        fs::read_to_string(home.join("big/file.txt")).unwrap(),
        "old"
    );

    let written = write(&core, "new").unwrap();
    assert_eq!(
        fs::read_to_string(home.join("big/file.txt")).unwrap(),
        "new"
    );
    let scope = json!({ "permission": "fs:read", "paths": ["~/big/**"] });
    let listed = call(
        &core,
        "fs.history",
        json!({ "path": "~/big/file.txt", "scope": scope }),
    )
    .unwrap();
    assert_eq!(listed["versions"][0]["id"], written["version"]);
    assert_eq!(listed["versions"][0]["sha256"], sha256(b"old"));
}
