//! Design systems in the theme pipeline (ADR 0091): plugins of kind design-system that theme.save,
//! theme.import, theme.export and theme.remove keep in the user themes folder under theme:manage, as
//! `.desk-design` bundles in the theme bundle format. They are always on, like themes.

mod support;

use std::fs;
use std::path::{Path, PathBuf};

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::Core;
use serde_json::{Value, json};
use support::{call, grant, home, plugin_manage, roots};

const RUNTIME: &str = "desk";
const SHARP: &str = "local.square-caps";

fn themes(home: &Path) -> PathBuf {
    home.join("data/themes")
}

fn desk(home: &Path) -> Core {
    let core = Core::new(roots(home)).with_themes_dir(themes(home));
    grant(&core, RUNTIME, json!({ "permission": "theme:manage" }));
    grant(&core, RUNTIME, plugin_manage());
    core
}

fn manifest(id: &str) -> Value {
    json!({
        "id": id, "name": "Square caps", "version": "1.0.0", "kind": "design-system",
        "description": "Square corners and caps on buttons.",
        "designSystem": {
            "license": "CC0-1.0",
            "components": {
                "button": { "shape": "none", "case": "uppercase" },
                "field": { "style": "underline" }
            }
        }
    })
}

fn theme(core: &Core, method: &str, mut params: Value) -> Result<Value, BridgeError> {
    params["scope"] = json!({ "permission": "theme:manage" });
    call(core, RUNTIME, &format!("theme.{method}"), params)
}

fn code(answer: Result<Value, BridgeError>) -> ErrorCode {
    answer.expect_err("the call is refused").code
}

#[test]
fn a_design_system_saves_into_the_user_folder_and_is_always_on() {
    let home = home("design-save");
    let core = desk(&home);
    let saved = theme(&core, "save", json!({ "manifest": manifest(SHARP) })).unwrap();
    assert_eq!(saved["plugin"]["status"], "ready");
    assert_eq!(saved["plugin"]["enabled"], true);
    assert_eq!(saved["plugin"]["manifest"]["kind"], "design-system");
    let dir = themes(&home).join(SHARP);
    let written: Value =
        serde_json::from_slice(&fs::read(dir.join("plugin.json")).unwrap()).unwrap();
    assert_eq!(written, manifest(SHARP));
    // Like a theme it is never turned off: desk.design.active picks the one in force.
    let off = call(
        &core,
        RUNTIME,
        "plugin.setEnabled",
        json!({ "plugin": SHARP, "enabled": false, "scope": plugin_manage() }),
    );
    let refused = off.expect_err("a design system stays on");
    assert!(
        refused.message.contains("desk.design.active"),
        "{}",
        refused.message
    );
}

#[test]
fn a_design_system_with_files_or_another_kind_never_lands() {
    let home = home("design-invalid");
    let core = desk(&home);
    // An option the catalogue does not name is refused as the request is read (spec vectors).
    let font = json!([{ "path": "fonts/a.woff2", "base64": "d09GMg==" }]);
    let with_files = json!({ "manifest": manifest(SHARP), "files": font });
    assert_eq!(
        code(theme(&core, "save", with_files)),
        ErrorCode::InvalidParams
    );
    let app = json!({ "id": "local.app", "version": "1.0.0", "kind": "ui", "entry": "index.html" });
    assert_eq!(
        code(theme(&core, "save", json!({ "manifest": app }))),
        ErrorCode::InvalidParams
    );
    assert!(!themes(&home).join(SHARP).exists());
}

#[test]
fn export_writes_a_desk_design_that_imports_back_and_remove_deletes_it() {
    let home = home("design-export");
    let core = desk(&home);
    theme(&core, "save", json!({ "manifest": manifest(SHARP) })).unwrap();
    let written = theme(&core, "export", json!({ "theme": SHARP })).unwrap();
    let file = home.join("Downloads").join(format!("{SHARP}.desk-design"));
    assert_eq!(written["path"], json!(file.to_string_lossy()));
    let bundle: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    assert_eq!(bundle["format"], "desk-theme/1");
    assert_eq!(bundle["manifest"], manifest(SHARP));
    assert_eq!(bundle["files"], json!({}));
    assert_eq!(
        theme(&core, "remove", json!({ "theme": SHARP })).unwrap(),
        json!({})
    );
    assert!(!themes(&home).join(SHARP).exists());
    let path = file.to_string_lossy().to_string();
    let back = theme(&core, "import", json!({ "path": path })).unwrap();
    assert_eq!(back["plugin"]["id"], SHARP);
    // Someone else's design system lands inside local. under its name.
    let mut shared = bundle.clone();
    shared["manifest"]["id"] = json!("example.blueprint");
    shared["manifest"]["name"] = json!("Blueprint");
    let theirs = theme(&core, "import", json!({ "bundle": shared })).unwrap();
    assert_eq!(theirs["plugin"]["id"], "local.blueprint");
    assert_eq!(theirs["plugin"]["manifest"]["kind"], "design-system");
}

#[test]
fn a_design_system_folder_dropped_in_by_hand_loads_at_start() {
    let home = home("design-start");
    let dir = themes(&home).join("local.by-hand");
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("plugin.json"),
        manifest("local.by-hand").to_string(),
    )
    .unwrap();
    let core = desk(&home);
    let plugin = core.plugins().into_iter().find(|p| p.id == "local.by-hand");
    let plugin = plugin.expect("the design system is installed");
    assert!(!plugin.built_in);
    assert!(plugin.enabled);
}
