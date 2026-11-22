//! The panic hook (#322): a panic anywhere writes one redacted report with where it happened and the
//! plugins that were on.

use std::fs;
use std::sync::Arc;

use desk_crash::{Context, Crashes, install_hook};

#[test]
fn the_panic_hook_writes_a_report() {
    let data = std::env::temp_dir().join(format!("desk-crash-hook-{}", std::process::id()));
    let _ = fs::remove_dir_all(&data);
    let home = std::env::temp_dir().join("endue-crash-fixture-home");
    let context = Arc::new(Context::new("0.1.0", None, Some(&home)));
    context.set_plugins(vec!["endue.notes".into()]);
    install_hook(data.clone(), context);

    let secret = home.join("Notes/secret.md").display().to_string();
    let worker = std::thread::Builder::new()
        .name("worker".into())
        .spawn(move || panic!("cannot read {secret}"))
        .unwrap();
    assert!(worker.join().is_err());

    let crashes = Crashes::in_data(&data);
    assert_eq!(crashes.count(), 1);
    let (_, report) = crashes.newest().unwrap();
    assert_eq!(report["kind"], "panic");
    assert_eq!(report["thread"], "worker");
    assert!(
        report["location"].as_str().unwrap().contains("hook.rs"),
        "{report}"
    );
    assert_eq!(report["plugins"], serde_json::json!(["endue.notes"]));
    assert!(
        report["message"]
            .as_str()
            .unwrap()
            .contains("~/Notes/secret.md"),
        "{report}"
    );
    assert!(
        !report.to_string().contains(&home.display().to_string()),
        "{report}"
    );
}

#[test]
fn a_failed_report_write_names_endue() {
    const CHILD: &str = "ENDUE_TEST_CRASH_WRITE_FAILURE";
    if std::env::var_os(CHILD).is_some() {
        // A file in place of the data directory makes report creation fail on every platform.
        let data = std::env::temp_dir().join(format!("endue-crash-file-{}", std::process::id()));
        fs::write(&data, []).unwrap();
        install_hook(data.clone(), Arc::new(Context::new("0.4.0", None, None)));
        let _ = std::panic::catch_unwind(|| panic!("endue fixture"));
        fs::remove_file(data).unwrap();
        return;
    }

    // Isolate the global panic hook and capture the diagnostic from the real write failure.
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "a_failed_report_write_names_endue",
            "--nocapture",
        ])
        .env(CHILD, "1")
        .output()
        .unwrap();
    assert!(output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(
        stderr
            .lines()
            .any(|line| line.starts_with("endue could not write the crash report (")),
        "the report write warning should identify endue"
    );
}
