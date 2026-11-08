//! The fake computer the computer.* tests share: Safari (frontmost, on the left) and TextEdit (on
//! the right), a main display and a window to capture, Safari's tree, and a core on it that keeps
//! screenshots and runs.

use std::fs;
use std::path::Path;
use std::sync::Arc;

use desk_computer::apps::App;
use desk_computer::ax::{Element, Node};
use desk_computer::fake::FakeComputer;
use desk_computer::screen::{Screenshot, Target, Window};
use desk_computer::{Computer, Rect};
use desk_core::Core;
use serde_json::{Value, json};

use super::support::*;

pub const PLUGIN: &str = "example.computer";
pub const MIRA: &str = "agent:mira";
pub const SAFARI: &str = "com.apple.Safari";
pub const TEXTEDIT: &str = "com.apple.TextEdit";

pub fn app(pid: i32, name: &str, id: &str, active: bool) -> App {
    let (bundle_id, path) = (Some(id.to_owned()), None);
    let (hidden, regular) = (false, true);
    App {
        pid,
        name: name.to_owned(),
        bundle_id,
        path,
        active,
        hidden,
        regular,
    }
}

pub fn window(id: u32, pid: i32, name: &str, bundle: &str, x: f64) -> Window {
    let bounds = Rect::new(x, 0.0, 700.0, 800.0);
    let title = Some(format!("{name} window"));
    let (bundle_id, layer, on_screen, alpha) = (Some(bundle.to_owned()), 0, true, 1.0);
    Window {
        id,
        pid,
        app: name.to_owned(),
        bundle_id,
        title,
        bounds,
        layer,
        on_screen,
        alpha,
    }
}

/// Safari (frontmost, on the left) and TextEdit (on the right), and a main display to capture.
pub fn fake() -> Arc<FakeComputer> {
    let screen = Rect::new(0.0, 0.0, 1440.0, 900.0);
    let shot = Screenshot::solid(screen, 0.1, [20, 40, 60, 255]).unwrap();
    Arc::new(
        FakeComputer::new()
            .with_apps(vec![
                app(412, "Safari", SAFARI, true),
                app(530, "TextEdit", TEXTEDIT, false),
            ])
            .with_windows(vec![
                window(7, 412, "Safari", SAFARI, 0.0),
                window(9, 530, "TextEdit", TEXTEDIT, 720.0),
            ])
            .with_screenshot(Target::MainDisplay, shot.clone())
            .with_screenshot(Target::Window(9), shot)
            .with_tree(
                412,
                Node::new(Element::new("AXApplication").title("Safari")).with(vec![Node::new(
                    Element::new("AXWindow").title("Start Page"),
                )]),
            )
            .with_focus(Some(vec![0]), None),
    )
}

/// A core on the fake keeping screenshots and runs, `desk` holding perm:manage and reading runs.
pub fn core(home: &Path, fake: &Arc<FakeComputer>) -> Core {
    let init = home.join("init.yaml");
    fs::write(&init, "").unwrap();
    let core = Core::new(roots(home))
        .with_prompter(NeverAsk)
        .with_init_file(init)
        .with_index_file(home.join("index.sqlite"))
        .with_computer(Arc::clone(fake) as Arc<dyn Computer>)
        .with_computer_shots(home.join("shots"));
    grant(&core, "desk", manage());
    grant(
        &core,
        "desk",
        json!({ "permission": "data:read", "kinds": ["run"] }),
    );
    core
}

pub fn see(apps: Option<&[&str]>) -> Value {
    match apps {
        Some(apps) => json!({ "permission": "computer:see", "apps": apps }),
        None => json!({ "permission": "computer:see" }),
    }
}

pub fn control(apps: Option<&[&str]>) -> Value {
    match apps {
        Some(apps) => json!({ "permission": "computer:control", "apps": apps }),
        None => json!({ "permission": "computer:control" }),
    }
}

pub fn click(
    core: &Core,
    caller: &str,
    x: f64,
    scope: Value,
) -> Result<Value, desk_bridge::BridgeError> {
    call(
        core,
        caller,
        "computer.input.click",
        json!({ "x": x, "y": 100.0, "scope": scope }),
    )
}

pub fn runs(core: &Core) -> Vec<Value> {
    let scope = json!({ "permission": "data:read", "kinds": ["run"] });
    let query = json!({ "kinds": ["run"], "sort": [{ "field": "startedAt", "dir": "asc" }] });
    let page = call(
        core,
        "desk",
        "data.query",
        json!({ "query": query, "scope": scope }),
    );
    page.unwrap()["items"].as_array().unwrap().clone()
}

/// `example.computer` providing the agent command `example.computer.click`, holding computer:control.
pub fn computer_plugin(core: &Core, home: &Path) {
    let dir = home.join("plugins/computer");
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>computer</p>").unwrap();
    let manifest = json!({ "id": PLUGIN, "version": "0.1.0", "kind": "ui", "entry": "ui/index.html",
        "contributes": { "commands": [{ "id": "example.computer.click", "title": "Click",
            "description": "Clicks.", "agent": true }] } });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    core.install_plugin(&dir, false);
    let click = json!({ "id": "example.computer.click", "title": "Click" });
    call(core, PLUGIN, "cmd.register", click).unwrap();
    grant(core, PLUGIN, control(None));
}
