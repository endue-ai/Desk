//! `desk open <path|link>` (#310): it starts the desk's executable (`DESK_APP`, a fake one here)
//! with an absolute path or a canonical link, and the desk's single-instance hand-off does the rest.
//! A link the desk would refuse starts nothing; no argument is a usage error.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{Duration, Instant};

#[test]
fn both_commands_name_the_same_app_when_it_cannot_start() {
    let missing = std::env::temp_dir().join(format!("endue-missing-app-{}", std::process::id()));
    for (name, bin) in [
        ("endue", env!("CARGO_BIN_EXE_endue")),
        ("desk", env!("CARGO_BIN_EXE_desk")),
    ] {
        let out = Command::new(bin)
            .args(["open", "endue.txt"])
            .env("DESK_APP", &missing)
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(1));
        let message = String::from_utf8(out.stderr).unwrap();
        assert!(message.starts_with(&format!("{name}: open: could not start endue (")));
    }
}

/// A fresh folder with a fake desk that writes the argument it was started with to `started`.
fn fake_desk(tag: &str) -> (PathBuf, PathBuf) {
    let dir = std::env::temp_dir().join(format!("desk-cli-open-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let app = dir.join("fake-desk.sh");
    let started = dir.join("started");
    std::fs::write(
        &app,
        format!("#!/bin/sh\nprintf '%s' \"$1\" > '{}'\n", started.display()),
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&app, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    (dir, app)
}

fn desk_open(app: &Path, cwd: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_desk"))
        .arg("open")
        .args(args)
        .env("DESK_APP", app)
        .current_dir(cwd)
        .output()
        .expect("desk runs")
}

/// What the fake desk was started with, once it wrote it.
fn started(dir: &Path) -> Option<String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if let Ok(text) = std::fs::read_to_string(dir.join("started")) {
            return Some(text);
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    None
}

#[cfg(unix)]
#[test]
fn desk_open_hands_a_path_or_link_to_the_desk() {
    let (dir, app) = fake_desk("path");
    let out = desk_open(&app, &dir, &["notes.md"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let path = started(&dir).expect("the desk was started");
    let dir_seen = std::fs::canonicalize(&dir).unwrap();
    assert!(
        path == dir.join("notes.md").to_string_lossy()
            || path == dir_seen.join("notes.md").to_string_lossy(),
        "{path}"
    );

    let (dir, app) = fake_desk("link");
    let out = desk_open(&app, &dir, &["ENDUE://v1/Plugin/endue.notes"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        started(&dir).as_deref(),
        Some("endue://v1/plugin/endue.notes")
    );

    let (dir, app) = fake_desk("refused");
    let out = desk_open(&app, &dir, &["endue://v1/nope"]);
    assert_eq!(out.status.code(), Some(1));
    let said = String::from_utf8_lossy(&out.stderr);
    assert!(
        said.starts_with("desk: open: ") && said.contains("does not do"),
        "{said}"
    );
    std::thread::sleep(Duration::from_millis(200));
    assert!(
        !dir.join("started").exists(),
        "a refused link starts nothing"
    );

    // A relative DESK_APP could name a program planted in the folder desk runs in: refused.
    let out = Command::new(env!("CARGO_BIN_EXE_desk"))
        .args(["open", "notes.md"])
        .env("DESK_APP", "fake-desk.sh")
        .current_dir(&dir)
        .output()
        .expect("desk runs");
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).contains("absolute path"));
    std::thread::sleep(Duration::from_millis(200));
    assert!(
        !dir.join("started").exists(),
        "a relative DESK_APP starts nothing"
    );

    let out = desk_open(&app, &dir, &[]);
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("  open <path|link>"));
}
