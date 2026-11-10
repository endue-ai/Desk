//! `desk plugin test <dir>`: a Wasm plugin's `tests/*.test.json` on the desk-plugin-host harness,
//! any other plugin's `tests/*.test.{js,ts}` with vitest on the SDK's test host.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn desk(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_desk"))
        .args(args)
        .output()
        .expect("desk runs")
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// A temporary plugin folder, removed when dropped.
struct Folder(PathBuf);

impl Folder {
    fn new(name: &str) -> Self {
        Self::under(&std::env::temp_dir(), name)
    }

    /// A folder in `base`: the system's temporary folder, or one inside the checkout.
    fn under(base: &Path, name: &str) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let dir = base.join(format!(
            "desk-cli-plugin-test-{}-{n}/{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    fn write(&self, path: &str, contents: &[u8]) {
        let file = self.0.join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, contents).unwrap();
    }

    fn arg(&self) -> &str {
        self.0.to_str().unwrap()
    }
}

impl Drop for Folder {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.0.parent().unwrap());
    }
}

const GREET: &str = r#"{
  "steps": ["start", { "command": { "id": "example.hello-wasm.greet", "args": { "name": "Ada" } } }],
  "answers": [{ "method": "fs.read", "params": { "path": "${plugin}/hello.txt" }, "result": "Hi" }],
  "expect": {
    "calls": [
      { "method": "cmd.register", "params": { "id": "example.hello-wasm.greet" } },
      { "method": "cmd.answer", "params": { "result": "Hello, Ada!" } }
    ]
  }
}"#;

/// examples/plugin-hello-wasm's manifest and committed component, with these tests.
fn hello_wasm(tests: &[(&str, &str)]) -> Folder {
    let example = repo().join("examples/plugin-hello-wasm");
    let folder = Folder::new("hello-wasm");
    for file in ["plugin.json", "build/wasm32-wasip2/release/hello.wasm"] {
        folder.write(file, &fs::read(example.join(file)).unwrap());
    }
    for (name, test) in tests {
        folder.write(&format!("tests/{name}"), test.as_bytes());
    }
    folder
}

#[test]
fn plugin_test_runs_a_wasm_plugins_json_tests_on_the_harness() {
    let folder = hello_wasm(&[("greet.test.json", GREET)]);
    let out = desk(&["plugin", "test", folder.arg()]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    let stdout = text(&out.stdout);
    assert!(stdout.contains("ok greet"), "{stdout}");
    assert!(stdout.contains("1 passed, 0 failed"), "{stdout}");
}

#[test]
fn plugin_test_fails_with_the_reason_when_a_case_fails() {
    let wrong = GREET.replace("Hello, Ada!", "Hello, Bob!");
    let folder = hello_wasm(&[("greet.test.json", GREET), ("wrong.test.json", &wrong)]);
    let out = desk(&["plugin", "test", folder.arg()]);
    assert_eq!(out.status.code(), Some(1));
    let (stdout, stderr) = (text(&out.stdout), text(&out.stderr));
    assert!(stdout.contains("ok greet"), "{stdout}");
    assert!(stdout.contains("FAILED wrong"), "{stdout}");
    assert!(stdout.contains("1 passed, 1 failed"), "{stdout}");
    assert!(stderr.contains("Hello, Bob!"), "{stderr}");
}

#[test]
fn plugin_test_fails_without_tests() {
    let folder = hello_wasm(&[]);
    let out = desk(&["plugin", "test", folder.arg()]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        text(&out.stderr).contains("no tests"),
        "{}",
        text(&out.stderr)
    );
}

const UI_MANIFEST: &str = r#"{
  "id": "example.counter",
  "name": "Counter",
  "version": "0.1.0",
  "kind": "ui",
  "entry": "ui/index.html"
}"#;

/// A test on the SDK's test host: the plugin's state and its bridge calls, in jsdom.
const UI_TEST: &str = r#"import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createTestHost } from "@endue-ai/plugin-sdk/testing";
import { expect, it } from "vitest";

it("counts into plugin state", async () => {
  document.body.innerHTML = "<p>0</p>";
  const host = createTestHost({ pluginId: "example.counter", state: { count: 1 } });
  await defineUiPlugin(
    {
      mount({ state }) {
        const count = (state.get()?.count ?? 0) + 1;
        state.set({ count });
        document.querySelector("p").textContent = String(count);
      },
    },
    host.transport,
  );
  await host.settle();
  expect(host.state).toEqual({ count: EXPECTED });
  expect(document.querySelector("p").textContent).toBe(String(EXPECTED));
});
"#;

fn ui_plugin(expected: u32) -> Folder {
    ui_plugin_in(Folder::new("counter"), expected)
}

fn ui_plugin_in(folder: Folder, expected: u32) -> Folder {
    folder.write("plugin.json", UI_MANIFEST.as_bytes());
    folder.write("ui/index.html", b"<!doctype html><p>0</p>");
    let test = UI_TEST.replace("EXPECTED", &expected.to_string());
    folder.write("tests/count.test.js", test.as_bytes());
    folder
}

#[test]
fn plugin_test_runs_a_ui_plugins_tests_on_the_sdk_test_host() {
    let folder = ui_plugin(2);
    let out = desk(&["plugin", "test", folder.arg()]);
    let stdout = text(&out.stdout);
    assert!(out.status.success(), "{stdout}\n{}", text(&out.stderr));
    assert!(stdout.contains("1 passed"), "{stdout}");
    // The test host leaves nothing in the plugin's folder.
    let mut left: Vec<String> = fs::read_dir(&folder.0)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    left.sort();
    assert_eq!(left, ["plugin.json", "tests", "ui"]);
}

#[test]
fn plugin_test_fails_when_a_ui_test_fails() {
    let folder = ui_plugin(3);
    let out = desk(&["plugin", "test", folder.arg()]);
    let (stdout, stderr) = (text(&out.stdout), text(&out.stderr));
    assert_eq!(out.status.code(), Some(1), "{stdout}\n{stderr}");
    // It fails on the expectation, not because the test did not load.
    assert!(stderr.contains("to deeply equal"), "{stdout}\n{stderr}");
}

/// Runs at once share nothing one of them clears. vitest keyed its module cache in the checkout
/// by the lockfile nearest the plugin's folder: the checkout's for a folder inside it, none for one
/// outside. Each change of key cleared the shared folder, and a run clearing it while another wrote
/// there failed with `ENOTEMPTY` (#139).
#[test]
fn plugin_test_runs_at_once_inside_and_outside_the_checkout() {
    let inside = PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
    for _ in 0..3 {
        let folders: Vec<Folder> = (0..4)
            .map(|i| {
                let base = if i % 2 == 0 {
                    inside.clone()
                } else {
                    std::env::temp_dir()
                };
                ui_plugin_in(Folder::under(&base, "counter"), 2)
            })
            .collect();
        let runs: Vec<_> = folders
            .iter()
            .map(|folder| {
                Command::new(env!("CARGO_BIN_EXE_desk"))
                    .args(["plugin", "test", folder.arg()])
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn()
                    .expect("desk runs")
            })
            .collect();
        for run in runs {
            let out = run.wait_with_output().expect("desk ends");
            let (stdout, stderr) = (text(&out.stdout), text(&out.stderr));
            assert!(out.status.success(), "{stdout}\n{stderr}");
        }
    }
}

#[test]
fn plugin_test_refuses_a_folder_that_does_not_validate() {
    let folder = Folder::new("broken");
    folder.write("plugin.json", br#"{ "id": "Broken" }"#);
    let out = desk(&["plugin", "test", folder.arg()]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        text(&out.stderr).contains("problem"),
        "{}",
        text(&out.stderr)
    );
}

#[test]
fn plugin_test_says_a_tool_plugin_has_no_test_host_yet() {
    let folder = Folder::new("tool");
    let manifest =
        r#"{ "id": "example.tool", "version": "0.1.0", "kind": "tool", "entry": "server.js" }"#;
    folder.write("plugin.json", manifest.as_bytes());
    folder.write("server.js", b"");
    let out = desk(&["plugin", "test", folder.arg()]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        text(&out.stderr).contains("no test host"),
        "{}",
        text(&out.stderr)
    );
}

#[test]
fn plugin_test_without_a_folder_is_a_usage_error() {
    let out = desk(&["plugin", "test"]);
    assert_eq!(out.status.code(), Some(2));
    assert!(text(&out.stderr).contains("plugin test <dir>"));
}
