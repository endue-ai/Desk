//! plugins.lock (specs/init/v0/lock.schema.json, ADR 0079): the core rewrites it on every install,
//! removal, version change and turn on or off, and only when its text changes; the folder digest it
//! pins; `desk_core::lock::plan`, what `desk plugin sync` does; a lock newer than this desk refused.

mod support;

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use desk_bridge::PluginsLock;
use desk_core::lock::{self, Plan};
use desk_core::{Core, folder_sha256};
use serde_json::{Value, json};
use support::{call, grant, home, plugin_manage, roots};

/// A desk whose home is a temp folder, its lock at `~/.desk/plugins.lock`.
fn desk(tag: &str) -> (Core, PathBuf, PathBuf) {
    let home = home(tag);
    let lock = home.join(".desk/plugins.lock");
    let core = Core::new(roots(&home))
        .with_plugin_store(home.join(".data/plugins.json"))
        .with_lock_file(lock.clone());
    grant(&core, "desk", plugin_manage());
    (core, home, lock)
}

fn plugin(parent: &Path, folder: &str, id: &str, version: &str) -> PathBuf {
    let dir = parent.join(folder);
    fs::create_dir_all(dir.join("ui")).unwrap();
    let manifest = json!({ "id": id, "version": version, "kind": "ui", "entry": "ui/index.html" });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    fs::write(dir.join("ui/index.html"), format!("<p>{id}</p>")).unwrap();
    dir
}

fn read(path: &Path) -> PluginsLock {
    lock::parse(&fs::read_to_string(path).unwrap()).unwrap()
}

fn set_enabled(core: &Core, id: &str, enabled: bool) {
    let params = json!({ "plugin": id, "enabled": enabled, "scope": plugin_manage() });
    call(core, "desk", "plugin.setEnabled", params).unwrap();
}

fn modified(path: &Path) -> SystemTime {
    fs::metadata(path).unwrap().modified().unwrap()
}

#[test]
fn installing_writes_one_line_per_plugin() {
    let (core, home, path) = desk("lock-install");
    let builtin = plugin(&home.join("app"), "alpha", "desk.alpha", "0.1.0");
    let folder = plugin(
        &home.join("plugins"),
        "beta",
        "example.beta",
        "0.2.0-beta.1",
    );
    core.install_plugin(&builtin, true);
    core.install_plugin(&folder, false);

    let text = fs::read_to_string(&path).unwrap();
    let lines: Vec<&str> = text.lines().filter(|l| l.starts_with("  - {")).collect();
    assert_eq!(lines.len(), 2, "one line per plugin:\n{text}");
    assert!(text.lines().any(|l| l == "version: 0"), "{text}");
    let locked = read(&path);
    assert_eq!(locked.version, 0);
    let alpha = &locked.plugins[0];
    assert_eq!(
        (
            alpha.id.as_str(),
            alpha.version.as_str(),
            alpha.source.as_str(),
            alpha.enabled
        ),
        ("desk.alpha", "0.1.0", "builtin", true)
    );
    assert_eq!(alpha.sha256, folder_sha256(&builtin).unwrap());
    let beta = &locked.plugins[1];
    assert_eq!(
        (
            beta.id.as_str(),
            beta.version.as_str(),
            beta.source.as_str(),
            beta.enabled
        ),
        (
            "example.beta",
            "0.2.0-beta.1",
            "folder:~/plugins/beta",
            true
        )
    );
    assert_eq!(beta.sha256.len(), 64);
    assert!(
        beta.sha256
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    );
}

#[test]
fn turning_off_changing_the_version_and_removing_rewrite_the_lock() {
    let (core, home, path) = desk("lock-change");
    let beta = plugin(&home.join("plugins"), "beta", "example.beta", "0.1.0");
    let gamma = plugin(&home.join("plugins"), "gamma", "example.gamma", "1.0.0");
    core.install_plugin(&gamma, false);
    core.install_plugin(&beta, false);
    let before = read(&path).plugins[0].sha256.clone();

    set_enabled(&core, "example.beta", false);
    assert!(!read(&path).plugins[0].enabled, "the line says off");

    let manifest =
        json!({ "id": "example.beta", "version": "0.2.0", "kind": "ui", "entry": "ui/index.html" });
    fs::write(beta.join("plugin.json"), manifest.to_string()).unwrap();
    core.install_plugin(&beta, false);
    let changed = read(&path);
    assert_eq!(changed.plugins[0].version, "0.2.0");
    assert_ne!(changed.plugins[0].sha256, before, "the folder changed");

    assert!(core.remove_plugin("example.beta"));
    let left: Vec<String> = read(&path).plugins.into_iter().map(|p| p.id).collect();
    assert_eq!(left, ["example.gamma"]);
    assert!(
        !core.remove_plugin("example.beta"),
        "nothing left to remove"
    );
}

#[test]
fn an_unchanged_desk_does_not_rewrite_the_lock() {
    let (core, home, path) = desk("lock-unchanged");
    let parent = home.join("plugins");
    for (folder, id) in [("a", "example.a"), ("b", "example.b"), ("c", "example.c")] {
        plugin(&parent, folder, id, "0.1.0");
    }
    let writes = core.lock_writes();
    core.install_plugins_in(&parent, false);
    assert_eq!(
        core.lock_writes(),
        writes + 1,
        "a whole folder is written once"
    );
    assert_eq!(read(&path).plugins.len(), 3);

    let old = UNIX_EPOCH + Duration::from_secs(1_700_000_000);
    let file = fs::File::options().write(true).open(&path).unwrap();
    file.set_modified(old).unwrap();
    drop(file);
    let text = fs::read_to_string(&path).unwrap();
    call(
        &core,
        "desk",
        "plugin.list",
        json!({ "scope": plugin_manage() }),
    )
    .unwrap();
    set_enabled(&core, "example.a", true);
    set_enabled(&core, "example.b", false);
    set_enabled(&core, "example.b", true);
    assert_eq!(fs::read_to_string(&path).unwrap(), text);
    assert_eq!(modified(&path), old, "the same text is not written again");
}

#[test]
fn the_folder_digest_ignores_order_and_hidden_files() {
    let root = home("lock-digest");
    let write = |dir: &Path, files: &[(&str, &str)]| {
        for (name, text) in files {
            let file = dir.join(name);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, text).unwrap();
        }
    };
    let (one, two) = (root.join("one"), root.join("two"));
    write(
        &one,
        &[("plugin.json", "{}"), ("ui/a.js", "a"), ("ui/b.js", "b")],
    );
    write(
        &two,
        &[("ui/b.js", "b"), ("ui/a.js", "a"), ("plugin.json", "{}")],
    );
    let digest = folder_sha256(&one).unwrap();
    assert_eq!(digest, folder_sha256(&two).unwrap(), "order does not count");

    write(
        &two,
        &[
            (".DS_Store", "finder"),
            (".git/config", "[core]"),
            ("ui/.cache", "x"),
        ],
    );
    assert_eq!(
        folder_sha256(&two).unwrap(),
        digest,
        "hidden files do not count"
    );
    write(&two, &[("ui/a.js", "A")]);
    assert_ne!(folder_sha256(&two).unwrap(), digest, "a changed byte does");
    write(&two, &[("ui/a.js", "a"), ("ui/ab.js", "")]);
    assert_ne!(
        folder_sha256(&two).unwrap(),
        digest,
        "an empty new file does"
    );
}

#[test]
fn sync_turns_plugins_on_and_off_as_the_lock_says() {
    let (core, home, _) = desk("lock-sync");
    let parent = home.join("plugins");
    for (folder, id, version) in [
        ("a", "example.a", "0.1.0"),
        ("b", "example.b", "0.1.0"),
        ("c", "example.c", "0.3.0"),
        ("d", "example.d", "0.1.0"),
    ] {
        core.install_plugin(&plugin(&parent, folder, id, version), false);
    }
    set_enabled(&core, "example.b", false);
    let line = |id: &str, version: &str, enabled: bool| {
        let sha256 = "0".repeat(64);
        json!({ "id": id, "version": version, "source": "builtin", "sha256": sha256, "enabled": enabled })
    };
    let locked: PluginsLock = serde_json::from_value(json!({
        "version": 0,
        "plugins": [
            line("example.a", "0.1.0", false),
            line("example.b", "0.1.0", true),
            line("example.c", "0.2.0", true),
            line("example.gone", "1.0.0", true),
        ]
    }))
    .unwrap();
    let plan: Plan = lock::plan(&locked, &core.plugins());
    assert_eq!(plan.disable, ["example.a"]);
    assert_eq!(plan.enable, ["example.b"]);
    assert_eq!(plan.missing, ["example.gone"]);
    assert_eq!(
        plan.versions,
        [(
            "example.c".to_owned(),
            "0.2.0".to_owned(),
            "0.3.0".to_owned()
        )],
        "a version that differs is noted, not changed"
    );
}

#[test]
fn a_lock_newer_than_this_desk_is_refused() {
    let newer = lock::parse("version: 1\nplugins: []\n").unwrap_err();
    assert!(newer.contains("newer than this Desk reads"), "{newer}");
    let broken = lock::parse("version: 0\nplugins: [{ id: x }]\n").unwrap_err();
    assert!(!broken.is_empty());
    let empty = lock::parse("version: 0\nplugins: []\n").unwrap();
    assert!(empty.plugins.is_empty());
    let text = lock::render(&empty);
    assert_eq!(
        lock::parse(&text).unwrap(),
        empty,
        "what it writes, it reads"
    );
    let value: Value = serde_json::to_value(&empty).unwrap();
    assert_eq!(value, json!({ "version": 0, "plugins": [] }));
}
