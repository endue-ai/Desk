//! `desk export` and `desk import` (#288): a desk as files. Each test runs the binary on a HOME and
//! a data folder of its own, offline.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{Value, json};

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// A fresh HOME with a data folder beside it.
struct Desk {
    home: PathBuf,
    data: PathBuf,
}

impl Desk {
    fn new(tag: &str) -> Self {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!("desk-cli-{tag}-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let desk = Desk {
            home: root.join("home"),
            data: root.join("data"),
        };
        fs::create_dir_all(desk.home.join(".desk")).unwrap();
        fs::create_dir_all(&desk.data).unwrap();
        desk
    }

    fn root(&self) -> PathBuf {
        self.home.parent().unwrap().to_owned()
    }

    fn put(&self, rel: &str, text: &str) {
        let path = self.home.join(".desk").join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn put_data(&self, name: &str, text: &str) {
        fs::write(self.data.join(name), text).unwrap();
    }

    fn read(&self, rel: &str) -> Option<String> {
        fs::read_to_string(self.home.join(".desk").join(rel)).ok()
    }

    /// `desk <args> --data <data>` with this HOME, and no desk on the socket unless `socket` names one.
    fn run(&self, args: &[&str], socket: Option<&Path>) -> Output {
        let mut command = Command::new(env!("CARGO_BIN_EXE_desk"));
        command
            .args(args)
            .args(["--data", self.data.to_str().unwrap()])
            .env("HOME", &self.home)
            .env(
                "DESK_SOCKET",
                socket.unwrap_or(&self.root().join("no.sock")),
            );
        command.output().expect("desk runs")
    }

    /// A desk with every desk folder file and some data, secrets included.
    fn full(tag: &str) -> Self {
        let desk = Desk::new(tag);
        desk.put("init.yaml", "profile: morning\n");
        desk.put("profiles/quiet.yaml", "name: Quiet\n");
        desk.put(
            "keys.yaml",
            "bindings:\n  - key: Mod+Shift+T\n    command: endue.terminal.new\n",
        );
        desk.put("views/my.launch.yaml", VIEW);
        desk.put("plugins.lock", "plugins: []\n");
        for name in ["store.json", "grants.json", "settings.json", "plugins.json"] {
            desk.put_data(name, "{}");
        }
        desk.put_data(
            "brain.json",
            r#"{"deskId":"d1","sessionId":"s1","transcript":[{"who":"person","text":"hi"}]}"#,
        );
        for secret in [
            "secrets.json",
            "account.json",
            "sync.json",
            "sync-mock.json",
            "index.sqlite",
        ] {
            desk.put_data(secret, "{}");
        }
        fs::create_dir_all(desk.data.join("history")).unwrap();
        desk
    }
}

const VIEW: &str = "id: my.launch\ntype: kanban\nsource:\n  file: ~/boards/launch.yaml\n";
const DESK_FILES: [&str; 5] = [
    "init.yaml",
    "profiles/quiet.yaml",
    "keys.yaml",
    "views/my.launch.yaml",
    "plugins.lock",
];

fn ok(out: &Output) -> String {
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn files_in(dir: &Path) -> Vec<String> {
    let mut found = Vec::new();
    let mut stack = vec![PathBuf::new()];
    while let Some(rel) = stack.pop() {
        for entry in fs::read_dir(dir.join(&rel)).unwrap().flatten() {
            let next = rel.join(entry.file_name());
            if entry.path().is_dir() {
                stack.push(next);
            } else {
                found.push(next.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    found.sort();
    found
}

#[test]
fn export_copies_the_desk_folder_and_writes_desk_json() {
    let desk = Desk::full("export");
    let out = desk.root().join("out");
    ok(&desk.run(&["export", out.to_str().unwrap()], None));
    let mut expected: Vec<String> = DESK_FILES.iter().map(|f| f.to_string()).collect();
    expected.push("desk.json".to_owned());
    expected.sort();
    assert_eq!(files_in(&out), expected);
    for rel in DESK_FILES {
        assert_eq!(
            fs::read(out.join(rel)).unwrap(),
            fs::read(desk.home.join(".desk").join(rel)).unwrap()
        );
    }
    let manifest: Value =
        serde_json::from_slice(&fs::read(out.join("desk.json")).unwrap()).unwrap();
    assert_eq!(manifest["version"], json!(0));
    assert!(["macos", "linux", "windows"].contains(&manifest["os"].as_str().unwrap()));
    assert!(
        manifest["exportedAt"].as_str().unwrap().ends_with('Z'),
        "{manifest}"
    );
}

#[test]
fn export_with_data_adds_the_data_files_but_never_secrets() {
    let desk = Desk::full("export-data");
    let out = desk.root().join("out");
    ok(&desk.run(&["export", out.to_str().unwrap(), "--with-data"], None));
    let data: Vec<String> = files_in(&out)
        .into_iter()
        .filter(|f| f.starts_with("data/"))
        .collect();
    assert_eq!(
        data,
        [
            "data/brain.json",
            "data/grants.json",
            "data/plugins.json",
            "data/settings.json",
            "data/store.json"
        ]
    );
}

#[test]
fn export_to_a_zip_imports_back_the_same_files() {
    let from = Desk::full("zip-from");
    let zip = from.root().join("desk.zip");
    ok(&from.run(&["export", zip.to_str().unwrap()], None));
    let to = Desk::new("zip-to");
    ok(&to.run(&["import", zip.to_str().unwrap()], None));
    for rel in DESK_FILES {
        assert_eq!(to.read(rel), from.read(rel), "{rel}");
    }
}

#[test]
fn import_writes_init_yaml_imported_beside_an_existing_init_yaml() {
    let from = Desk::full("init-from");
    let out = from.root().join("out");
    ok(&from.run(&["export", out.to_str().unwrap()], None));
    let to = Desk::new("init-to");
    to.put("init.yaml", "profile: default\n");
    let said = ok(&to.run(&["import", out.to_str().unwrap()], None));
    assert_eq!(to.read("init.yaml").as_deref(), Some("profile: default\n"));
    assert_eq!(
        to.read("init.yaml.imported").as_deref(),
        Some("profile: morning\n")
    );
    assert!(said.contains("init.yaml.imported"), "{said}");
}

#[test]
fn import_replaces_the_other_desk_files() {
    let from = Desk::full("replace-from");
    let out = from.root().join("out");
    ok(&from.run(&["export", out.to_str().unwrap()], None));
    let to = Desk::new("replace-to");
    to.put("keys.yaml", "bindings: []\n");
    to.put("profiles/mine.yaml", "name: Mine\n");
    ok(&to.run(&["import", out.to_str().unwrap()], None));
    assert_eq!(to.read("keys.yaml"), from.read("keys.yaml"));
    assert_eq!(to.read("views/my.launch.yaml").as_deref(), Some(VIEW));
    assert_eq!(to.read("plugins.lock").as_deref(), Some("plugins: []\n"));
    assert_eq!(
        to.read("profiles/mine.yaml").as_deref(),
        Some("name: Mine\n"),
        "kept"
    );
}

#[test]
fn import_refuses_a_newer_version_and_writes_nothing() {
    let from = Desk::full("newer-from");
    let out = from.root().join("out");
    ok(&from.run(&["export", out.to_str().unwrap()], None));
    fs::write(
        out.join("desk.json"),
        r#"{"version":1,"os":"linux","exportedAt":"2027-01-01T00:00:00Z"}"#,
    )
    .unwrap();
    let to = Desk::new("newer-to");
    let refused = to.run(&["import", out.to_str().unwrap()], None);
    assert_eq!(refused.status.code(), Some(1));
    let said = String::from_utf8_lossy(&refused.stderr);
    assert!(
        said.contains("version 1") && said.contains("version 0"),
        "{said}"
    );
    assert_eq!(said.trim().lines().count(), 1, "{said}");
    assert!(files_in(&to.home.join(".desk")).is_empty());
}

#[cfg(unix)]
#[test]
fn import_of_data_refuses_while_a_desk_answers() {
    let from = Desk::full("busy-from");
    let out = from.root().join("out");
    ok(&from.run(&["export", out.to_str().unwrap(), "--with-data"], None));
    let to = Desk::new("busy-to");
    let socket = to.root().join("desk.sock");
    let _listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
    let refused = to.run(
        &["import", out.to_str().unwrap(), "--with-data"],
        Some(&socket),
    );
    assert_eq!(refused.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&refused.stderr).contains("quit Desk first"));
    assert!(files_in(&to.data).is_empty());
    // brain.json comes back with its transcript only, once no desk answers.
    ok(&to.run(&["import", out.to_str().unwrap(), "--with-data"], None));
    let brain: Value =
        serde_json::from_slice(&fs::read(to.data.join("brain.json")).unwrap()).unwrap();
    assert_eq!(
        brain,
        json!({ "deskId": "", "transcript": [{ "who": "person", "text": "hi" }] })
    );
}

#[test]
fn export_counts_every_file_it_writes() {
    let desk = Desk::full("count");
    let zip = desk.root().join("desk.zip");
    let said = ok(&desk.run(&["export", zip.to_str().unwrap(), "--with-data"], None));
    // desk.json, the five desk folder files and the five data files an export carries.
    let expected = format!(
        "exported 11 file(s) (desk.json, 5 from the desk folder, 5 data file(s)) to {}\n",
        zip.display()
    );
    assert_eq!(said, expected);
    let out = desk.root().join("out");
    let said = ok(&desk.run(&["export", out.to_str().unwrap()], None));
    let six = "exported 6 file(s) (desk.json, 5 from the desk folder) to ";
    assert!(said.starts_with(six), "{said}");
    assert_eq!(files_in(&out).len(), 6);
}

#[test]
fn import_says_which_files_it_replaced() {
    let from = Desk::full("replaced-from");
    let zip = from.root().join("desk.zip");
    ok(&from.run(&["export", zip.to_str().unwrap(), "--with-data"], None));
    let to = Desk::new("replaced-to");
    let args = ["import", zip.to_str().unwrap(), "--with-data"];
    let first = ok(&to.run(&args, None));
    let nothing = !first.lines().any(|line| line.starts_with("replaced "));
    assert!(nothing, "a new HOME has nothing to replace: {first}");
    // The person's desk moves on; a second import of the same export puts it back, and says so.
    to.put_data("store.json", r#"{"desk":{"moved":"on"}}"#);
    to.put("keys.yaml", "bindings: []\n");
    let second = ok(&to.run(&args, None));
    let replaced: Vec<&str> = second
        .lines()
        .filter(|l| l.starts_with("replaced "))
        .collect();
    let store = format!("replaced {}", to.data.join("store.json").display());
    let keys = format!("replaced {}", to.home.join(".desk/keys.yaml").display());
    assert_eq!(replaced, [store.as_str(), keys.as_str()], "{second}");
}

#[test]
fn import_of_a_file_that_is_no_zip_says_so() {
    let to = Desk::new("not-zip");
    let file = to.root().join("notes.txt");
    fs::write(&file, "hello\n").unwrap();
    let refused = to.run(&["import", file.to_str().unwrap()], None);
    assert_eq!(refused.status.code(), Some(1));
    let said = String::from_utf8_lossy(&refused.stderr);
    assert!(
        said.contains("neither a folder nor a zip archive"),
        "{said}"
    );
    assert!(!said.contains("os error"), "{said}");
    // A zip that has lost its .zip still imports.
    let from = Desk::full("not-zip-from");
    let zip = from.root().join("desk.zip");
    ok(&from.run(&["export", zip.to_str().unwrap()], None));
    let renamed = from.root().join("desk.backup");
    fs::rename(&zip, &renamed).unwrap();
    ok(&to.run(&["import", renamed.to_str().unwrap()], None));
    assert_eq!(to.read("keys.yaml"), from.read("keys.yaml"));
}
