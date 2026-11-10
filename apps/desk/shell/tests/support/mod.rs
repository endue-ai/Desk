//! Runs the surface probe (`src/probe.rs`) of the built shell and reads its report. On macOS CEF runs
//! only from the bundle (`just build-shell`), elsewhere from the test's own binary. A missing or
//! stale bundle skips the test with a message; `DESK_SHELL_REQUIRE_PROBE=1` makes that a failure.
#![allow(dead_code)]

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use serde_json::Value;

/// The shell binary that can run CEF here, or why there is none.
fn binary() -> Result<PathBuf, String> {
    let built = PathBuf::from(env!("CARGO_BIN_EXE_endue-desk"));
    if !cfg!(target_os = "macos") {
        return Ok(built);
    }
    let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let target = std::env::var_os("CARGO_TARGET_DIR")
        .map_or_else(|| workspace.join("target"), PathBuf::from);
    let bundled = target.join("bundle/endue-desk.app/Contents/MacOS/endue-desk");
    let modified = |p: &PathBuf| std::fs::metadata(p).and_then(|m| m.modified()).ok();
    match (modified(&bundled), modified(&built)) {
        (None, _) => Err(format!(
            "no bundle at {} (just build-shell)",
            bundled.display()
        )),
        (Some(b), Some(t)) if b + Duration::from_secs(5) < t => {
            Err("the bundle is older than this build (just build-shell)".to_owned())
        }
        _ => Ok(bundled),
    }
}

/// The probe's report for `scenario` with `env`, or `None` (skipped) when no shell can run here.
pub fn probe(test: &str, scenario: &str, env: &[(&str, &str)]) -> Option<Value> {
    let binary = match binary() {
        Ok(binary) => binary,
        Err(why) if std::env::var_os("DESK_SHELL_REQUIRE_PROBE").is_some() => {
            panic!("{test}: {why} (DESK_SHELL_REQUIRE_PROBE is set)")
        }
        Err(why) => {
            eprintln!("{test}: skipped, {why}");
            return None;
        }
    };
    let home =
        std::env::temp_dir().join(format!("desk-probe-home-{}-{scenario}", std::process::id()));
    std::fs::create_dir_all(&home).expect("a throwaway home");
    let mut command = Command::new(&binary);
    command
        .arg(format!("--surface-probe={scenario}"))
        .env("HOME", &home)
        .env_remove("DESK_REMOTE_DEBUGGING_PORT")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    for (name, value) in env {
        command.env(name, value);
    }
    let output = command.output().expect("the probe runs");
    let _ = std::fs::remove_dir_all(&home);
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text
        .lines()
        .find_map(|l| l.strip_prefix("SURFACE-PROBE "))
        .unwrap_or_else(|| {
            panic!(
                "{test}: no report from {} ({})",
                binary.display(),
                output.status
            )
        });
    let report: Value = serde_json::from_str(line).expect("the report is JSON");
    assert!(report.get("error").is_none(), "{test}: {report}");
    Some(report)
}

/// Whether two colours are within 3 of each other on every channel.
pub fn near(got: &Value, want: &Value) -> bool {
    let (Some(got), Some(want)) = (got.as_array(), want.as_array()) else {
        return false;
    };
    want.iter().zip(got).all(|(w, g)| {
        w.as_i64()
            .zip(g.as_i64())
            .is_some_and(|(w, g)| (w - g).abs() <= 3)
    })
}
