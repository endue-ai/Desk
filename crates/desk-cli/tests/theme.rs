//! `desk theme` against the real stack: the binary, the desk socket and a `Core` keeping user themes
//! in a temporary folder (ADR 0058). The CLI holds theme:manage, plugin:manage and cmd:invoke; the
//! runtime (`desk`) provides `desk.theme.use`, which answers the theme now in force.
#![cfg(unix)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use desk_bridge::{BridgeEvent, BridgeRequest, BridgeResponse, Permission};
use desk_core::{Core, Roots};
use desk_ipc::{CALLER, Listener};
use serde_json::{Value, json};

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn call(core: &Core, caller: &str, method: &str, params: Value) -> BridgeResponse {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params })).unwrap();
    core.handle(caller, request)
}

fn grant(core: &Core, permission: Value) {
    let permission: Permission = serde_json::from_value(permission).unwrap();
    core.grant(CALLER, permission);
}

struct Desk {
    home: PathBuf,
    socket: PathBuf,
    used: Arc<Mutex<Vec<Value>>>,
    _core: Arc<Core>,
    _listener: Listener,
}

impl Desk {
    fn start() -> Self {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let nanos = format!("{nanos}-{n}");
        let home = std::env::temp_dir().join(format!("dcli-theme-{}-{nanos}", std::process::id()));
        fs::create_dir_all(home.join("builtin/ember")).unwrap();
        // The CLI makes relative paths absolute from its working folder, which the OS resolves.
        let home = fs::canonicalize(home).unwrap();
        let builtin = home.join("builtin/ember");
        let ember = json!({ "id": "example.ember", "name": "Ember", "version": "0.1.0", "kind": "theme",
            "theme": { "dark": { "colors": { "background": "#1a1210" } } } });
        fs::write(builtin.join("plugin.json"), ember.to_string()).unwrap();
        let core = Arc::new(
            Core::new(Roots { home: home.clone() }).with_themes_dir(home.join("data/themes")),
        );
        core.install_plugin(&builtin, true);
        grant(&core, json!({ "permission": "theme:manage" }));
        grant(&core, json!({ "permission": "plugin:manage" }));
        grant(&core, json!({ "permission": "cmd:invoke", "ids": ["*"] }));
        let registered = call(
            &core,
            "desk",
            "cmd.register",
            json!({ "id": "desk.theme.use", "title": "Use a theme" }),
        );
        assert!(matches!(registered, BridgeResponse::BridgeSuccess(_)));

        // The runtime's part: desk.theme.use puts an installed theme in force and answers its id.
        let used = Arc::new(Mutex::new(Vec::new()));
        let (events, provider, seen) = (
            core.events().subscribe(),
            Arc::clone(&core),
            Arc::clone(&used),
        );
        std::thread::spawn(move || {
            for event in events {
                let BridgeEvent::CmdInvoked(invoked) = event else {
                    continue;
                };
                let args = invoked.data.args.map(Value::Object).unwrap_or_default();
                let id = args["id"].as_str().unwrap_or_default().to_owned();
                seen.lock().unwrap().push(args);
                let known = provider.plugins().iter().any(|p| p.id == id);
                let answer = json!({ "invocationId": invoked.data.invocation_id, "result": if known { id } else { String::new() } });
                call(&provider, "desk", "cmd.answer", answer);
            }
        });
        let socket =
            std::env::temp_dir().join(format!("dcli-th-{}-{nanos}.sock", std::process::id()));
        let listener = Listener::bind(&socket, Arc::clone(&core)).expect("bind the desk socket");
        Self {
            home,
            socket,
            used,
            _core: core,
            _listener: listener,
        }
    }

    fn desk(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_desk"))
            .args(args)
            .current_dir(&self.home)
            .env("DESK_SOCKET", &self.socket)
            .output()
            .expect("desk runs")
    }

    fn ok(&self, args: &[&str]) -> String {
        let out = self.desk(args);
        assert_eq!(
            out.status.code(),
            Some(0),
            "{args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    fn fails(&self, args: &[&str], code: i32) -> String {
        let out = self.desk(args);
        assert_eq!(
            out.status.code(),
            Some(code),
            "{args:?}: {}",
            String::from_utf8_lossy(&out.stdout)
        );
        String::from_utf8_lossy(&out.stderr).into_owned()
    }
}

/// A `.desk-theme` file in `home`: Paper & Ink, with an id outside local. and one font.
fn paper(home: &Path) {
    let manifest = json!({ "id": "endue.theme-paper", "name": "Paper & Ink", "version": "1.0.0", "kind": "theme",
        "theme": { "type": { "fonts": [{ "family": "Ink", "src": "fonts/ink.woff2" }] },
                   "light": { "colors": { "background": "#f6f1e7" } } } });
    let bundle = json!({ "format": "desk-theme/1", "manifest": manifest, "files": { "fonts/ink.woff2": "d09GMiBpbms=" } });
    fs::write(home.join("paper.desk-theme"), bundle.to_string()).unwrap();
}

#[test]
fn desk_theme_imports_lists_applies_exports_and_removes() {
    let desk = Desk::start();
    paper(&desk.home);
    assert_eq!(
        desk.ok(&["theme", "import", "paper.desk-theme"]),
        "local.paper-ink\n"
    );
    assert_eq!(
        desk.ok(&["theme", "list"]),
        "example.ember\tready\tbuilt-in\tEmber\nlocal.paper-ink\tready\tuser\tPaper & Ink\n"
    );

    assert_eq!(desk.ok(&["theme", "apply", "local.paper-ink"]), "ok\n");
    assert_eq!(
        desk.used.lock().unwrap().last(),
        Some(&json!({ "id": "local.paper-ink" }))
    );
    let unknown = desk.fails(&["theme", "apply", "local.nothing"], 1);
    assert!(
        unknown.contains("no installed theme local.nothing"),
        "{unknown}"
    );

    let out = desk.home.join("out/paper.desk-theme");
    let printed = desk.ok(&["theme", "export", "local.paper-ink", "out/paper.desk-theme"]);
    assert_eq!(printed, format!("{}\n", out.display()));
    let bundle: Value = serde_json::from_slice(&fs::read(&out).unwrap()).unwrap();
    assert_eq!(bundle["manifest"]["id"], "local.paper-ink");
    assert_eq!(
        bundle["files"],
        json!({ "fonts/ink.woff2": "d09GMiBpbms=" })
    );
    let default = desk.ok(&["theme", "export", "example.ember"]);
    assert_eq!(
        default,
        format!(
            "{}\n",
            desk.home
                .join("Downloads/example.ember.desk-theme")
                .display()
        )
    );

    assert_eq!(desk.ok(&["theme", "remove", "local.paper-ink"]), "ok\n");
    assert_eq!(
        desk.ok(&["theme", "list"]),
        "example.ember\tready\tbuilt-in\tEmber\n"
    );
    let builtin = desk.fails(&["theme", "remove", "example.ember"], 1);
    assert!(builtin.contains("invalid_params"), "{builtin}");
    let json = desk.ok(&["--json", "theme", "import", "paper.desk-theme"]);
    let answer: Value = serde_json::from_str(&json).unwrap();
    assert_eq!(answer["result"]["plugin"]["id"], "local.paper-ink");
}

/// A theme plugin folder `dir` with `id` and `name`.
fn theme_folder(dir: &Path, id: &str, name: &str) {
    fs::create_dir_all(dir).unwrap();
    let manifest = json!({ "id": id, "name": name, "version": "0.1.0", "kind": "theme",
        "theme": { "dark": { "colors": { "background": "#101010" } } } });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
}

#[test]
fn desk_theme_list_says_where_each_theme_comes_from() {
    let desk = Desk::start();
    let core = &desk._core;
    // Folders the desk was started with (DESK_DEV_PLUGINS): a theme, and one that is no plugin.
    let dev = desk.home.join("dev");
    theme_folder(
        &dev.join("hello-theme"),
        "example.hello-theme",
        "Hello theme",
    );
    core.install_plugin(&dev.join("hello-theme"), false);
    fs::create_dir_all(dev.join("brain-echo")).unwrap();
    let not_a_plugin = core.install_plugin(&dev.join("brain-echo"), false);
    // A pack's nested theme, and a user theme whose manifest is broken.
    let nested = desk.home.join("packs/morning/plugins/dusk");
    theme_folder(&nested, "example.dusk", "Dusk");
    core.install_plugin(&nested, false);
    let torn = desk.home.join("data/themes/local.torn");
    fs::create_dir_all(&torn).unwrap();
    fs::write(
        torn.join("plugin.json"),
        r#"{ "id": "local.torn", "kind": "theme" }"#,
    )
    .unwrap();
    let torn = core.install_plugin(&torn, false);
    assert_eq!(format!("{:?}", torn.status), "Failed");

    let listed = desk.ok(&["theme", "list"]);
    let lines: Vec<&str> = listed.lines().collect();
    assert!(
        lines.contains(&"example.ember\tready\tbuilt-in\tEmber"),
        "{listed}"
    );
    assert!(
        lines.contains(&"example.hello-theme\tready\tdev\tHello theme"),
        "{listed}"
    );
    assert!(
        lines.contains(&"example.dusk\tready\tpack\tDusk"),
        "{listed}"
    );
    let torn_line = format!("{}\tfailed\tuser\t-", torn.id);
    assert!(lines.contains(&torn_line.as_str()), "{listed}");
    assert!(
        !listed.contains(&not_a_plugin.id),
        "a folder that is no plugin is no theme: {listed}"
    );
    assert_eq!(lines.len(), 4, "{listed}");
    // What the list calls dev, theme remove does not take for a user theme either.
    let refused = desk.fails(&["theme", "remove", "example.hello-theme"], 1);
    assert!(refused.contains("is not a user theme"), "{refused}");
}

#[test]
fn desk_theme_usage_errors_exit_2() {
    let desk = Desk::start();
    for args in [
        &["theme"][..],
        &["theme", "apply"],
        &["theme", "import"],
        &["theme", "export"],
        &["theme", "remove"],
        &["theme", "list", "x"],
        &["theme", "export", "a", "b", "c"],
    ] {
        let stderr = desk.fails(args, 2);
        assert!(stderr.contains("usage: desk"), "{args:?}: {stderr}");
    }
}
