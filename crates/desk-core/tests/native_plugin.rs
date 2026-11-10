//! Native plugins (#59, ADR 0154): kind `native` names a program per OS. The core loads such a plugin
//! only with a program for this OS that is there; it says what starting it runs; it starts the
//! process with its two connections, and the bridge connection calls as that plugin, whatever the
//! process says; the process's end is a death unless the desk asked it to stop, and one that does
//! not stop within its grace is killed. The programs here are shell scripts that speak the wire.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use desk_bridge::PluginStatus;
use desk_core::native::{self, Exit};
use desk_core::{Core, Roots};
use serde_json::{Value, json};

const ID: &str = "example.native-test";

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!(
        "desk-native-{tag}-{}-{nanos}-{n}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// A native plugin folder in `parent` whose program for `platform` is `bin/plugin`, holding
/// `script` when given; it declares `ui:notify` and a setting of its own.
fn plugin(parent: &Path, platform: &str, script: Option<&str>) -> PathBuf {
    let dir = parent.join("native-test");
    fs::create_dir_all(dir.join("bin")).unwrap();
    let manifest = json!({ "id": ID, "version": "0.1.0", "kind": "native",
        "native": { "binaries": { platform: "bin/plugin" }, "args": ["--hello"], "graceMs": 300 },
        "surfaces": [{ "id": "main", "title": "Native test", "placement": "center" }],
        "permissions": [{ "permission": "ui:notify" }],
        "contributes": { "settings": {
            "example.native-test.speed": { "kind": "number", "default": 1.5 } } } });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    if let Some(script) = script {
        let program = dir.join("bin/plugin");
        fs::write(&program, format!("#!/bin/sh\n{script}\n")).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&program, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
    dir
}

fn core(home: &Path) -> Arc<Core> {
    Arc::new(Core::new(Roots {
        home: home.to_owned(),
    }))
}

#[test]
fn a_native_plugin_loads_with_its_program_for_this_os_and_says_what_starting_it_runs() {
    let home = temp_dir("launch");
    let dir = plugin(&home, native::platform(), Some("exit 0"));
    let core = core(&home);
    let info = core.install_plugin(&dir, false);
    assert_eq!(
        (info.status, info.error.as_deref()),
        (PluginStatus::Ready, None)
    );
    let launch = core
        .native_launch(ID)
        .expect("a ready native plugin starts");
    assert_eq!(launch.plugin, ID);
    assert_eq!(launch.program, dir.join("bin/plugin"));
    assert_eq!(launch.dir, dir);
    assert_eq!(launch.args, vec!["--hello".to_owned()]);
    assert_eq!(launch.grace, Duration::from_millis(300));
    assert!(
        core.native_launch("example.other").is_err(),
        "no such plugin"
    );
}

#[test]
fn a_native_plugin_without_a_program_for_this_os_or_with_a_missing_one_does_not_load() {
    let home = temp_dir("other-os");
    let other = if native::platform() == "linux-x86_64" {
        "windows-x86_64"
    } else {
        "linux-x86_64"
    };
    let foreign = core(&home).install_plugin(&plugin(&home, other, Some("exit 0")), false);
    assert_eq!(foreign.status, PluginStatus::Failed);
    assert!(
        foreign
            .error
            .as_deref()
            .is_some_and(|e| e.contains(native::platform())),
        "{foreign:?}"
    );
    let home = temp_dir("missing");
    let missing = core(&home).install_plugin(&plugin(&home, native::platform(), None), false);
    assert_eq!(missing.status, PluginStatus::Failed);
    assert!(
        missing
            .error
            .as_deref()
            .is_some_and(|e| e.contains("does not exist")),
        "{missing:?}"
    );
}

#[test]
fn a_ui_plugin_is_no_native_plugin() {
    let home = temp_dir("ui");
    let dir = home.join("hello");
    fs::create_dir_all(dir.join("ui")).unwrap();
    let manifest = json!({ "id": "example.hello-ui", "version": "0.1.0", "kind": "ui",
        "entry": "ui/index.html" });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>hi</p>").unwrap();
    let core = core(&home);
    assert_eq!(core.install_plugin(&dir, false).status, PluginStatus::Ready);
    assert!(core.native_launch("example.hello-ui").is_err());
}

#[cfg(unix)]
mod process {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::sync::mpsc;

    /// Start the plugin whose program is `script`; its end comes on the channel.
    fn start(
        tag: &str,
        script: &str,
    ) -> (
        native::NativeProcess,
        mpsc::Receiver<native::Ended>,
        PathBuf,
    ) {
        let home = temp_dir(tag);
        let dir = plugin(&home, native::platform(), Some(script));
        let core = core(&home);
        assert_eq!(core.install_plugin(&dir, false).status, PluginStatus::Ready);
        let launch = core.native_launch(ID).unwrap();
        let (tx, rx) = mpsc::channel();
        let process = native::NativeProcess::start(&core, &launch, &[], move |ended| {
            let _ = tx.send(ended);
        })
        .expect("the program starts");
        (process, rx, dir)
    }

    fn ended(rx: &mpsc::Receiver<native::Ended>) -> native::Ended {
        rx.recv_timeout(Duration::from_secs(10))
            .expect("the process ended")
    }

    /// Wait until the program in `dir` runs: it writes `started` first. A new program's first start
    /// can take a while on macOS, which checks it.
    fn running(dir: &Path) {
        let until = Instant::now() + Duration::from_secs(10);
        while !dir.join("started").exists() {
            assert!(Instant::now() < until, "the program never started");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// The bridge answers, as the process wrote them to `out` (one per line).
    fn answers(dir: &Path) -> Vec<Value> {
        let text = fs::read_to_string(dir.join("out")).unwrap_or_default();
        text.lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    #[test]
    fn the_bridge_connection_calls_as_the_plugin_and_cannot_become_anyone_else() {
        // Its own setting needs no permission; fs.read is not declared; socket.agent is the CLI's.
        let script = r#"
printf '%s\n' '{"id":1,"method":"settings.get","params":{"key":"speed"}}' >&"$DESK_BRIDGE_FD"
read -r one <&"$DESK_BRIDGE_FD"; printf '%s\n' "$one" >> out
printf '%s\n' '{"id":2,"method":"socket.agent","params":{"agent":"codex"}}' >&"$DESK_BRIDGE_FD"
read -r two <&"$DESK_BRIDGE_FD"; printf '%s\n' "$two" >> out
printf '%s\n' '{"id":3,"method":"fs.read","params":{"path":"~/x","scope":{"permission":"fs:read","paths":["~/**"]}}}' >&"$DESK_BRIDGE_FD"
read -r three <&"$DESK_BRIDGE_FD"; printf '%s\n' "$three" >> out
printf '%s %s %s\n' "$DESK_PLUGIN_ID" "$1" "$(pwd)" > env
"#;
        let (_process, rx, dir) = start("bridge", script);
        let end = ended(&rx);
        assert_eq!((end.exit, end.asked), (Exit::Code(0), false));
        let answers = answers(&dir);
        assert_eq!(answers.len(), 3, "{answers:?}");
        assert_eq!(answers[0]["id"], 1);
        assert_eq!(answers[0]["result"]["value"], 1.5, "its own setting");
        assert_eq!(answers[1]["ok"], false, "a plugin never becomes an agent");
        assert_eq!(answers[2]["ok"], false, "fs:read is not in its manifest");
        let env = fs::read_to_string(dir.join("env")).unwrap();
        let dir = fs::canonicalize(&dir).unwrap();
        assert_eq!(env.trim(), format!("{ID} --hello {}", dir.display()));
    }

    #[test]
    fn the_surface_connection_reaches_the_process() {
        let script = r#"
read -r line <&"$DESK_SURFACE_FD"; printf '%s\n' "$line" > got
printf '%s\n' '{"type":"ready","surface":"main.example-native--test"}' >&"$DESK_SURFACE_FD"
"#;
        let (mut process, rx, dir) = start("surface", script);
        let surface = process
            .take_surface()
            .expect("the desk's end of the surface connection");
        use std::io::Write;
        (&surface)
            .write_all(b"{\"type\":\"show\",\"surface\":\"main.example-native--test\"}\n")
            .unwrap();
        let mut line = String::new();
        BufReader::new(&surface).read_line(&mut line).unwrap();
        assert!(line.contains("\"ready\""), "{line}");
        assert_eq!(ended(&rx).exit, Exit::Code(0));
        assert!(
            fs::read_to_string(dir.join("got"))
                .unwrap()
                .contains("\"show\"")
        );
        assert!(process.pid() > 0);
    }

    #[test]
    fn a_process_that_ends_by_itself_died_and_one_asked_to_stop_did_not() {
        let (_process, rx, _) = start("exits", "exit 3");
        let end = ended(&rx);
        assert_eq!((end.exit, end.asked), (Exit::Code(3), false));
        // It stops when its connections close: read waits for the end of the surface connection.
        let script = r#": > started; read -r line <&"$DESK_SURFACE_FD"; exit 0"#;
        let (process, rx, dir) = start("stops", script);
        running(&dir);
        process.stop();
        let end = ended(&rx);
        assert_eq!((end.exit, end.asked), (Exit::Code(0), true));
    }

    #[test]
    fn a_process_that_does_not_stop_within_its_grace_is_killed() {
        let script = ": > started; trap '' TERM; while :; do sleep 1; done";
        let (process, rx, dir) = start("stubborn", script);
        running(&dir);
        let asked = Instant::now();
        process.stop();
        let end = ended(&rx);
        assert_eq!((end.exit, end.asked), (Exit::Signal(9), true));
        let took = asked.elapsed();
        assert!(
            took >= Duration::from_millis(250) && took < Duration::from_secs(5),
            "killed after its 300 ms grace, not before: {took:?}"
        );
    }
}
