//! Theme plugins (ADR 0056, docs/ko/theme-requirements.md TH-02, TH-09): a `theme` block and its font
//! and image files, no code. The desk validates the block against specs/plugin and checks the files
//! are there and small enough; it installs a theme like a library, always on and never mounted.

mod support;

use std::fs;
use std::path::{Path, PathBuf};

use desk_bridge::{ErrorCode, PluginKind, PluginStatus, ThemeRadius};
use desk_core::{Core, validate_dir};
use serde_json::{Value, json};
use support::{call, grant, home, plugin_manage, roots};

const THEME: &str = "example.paper";

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/theme")
}

/// A copy of the fixture theme under `home`, with its manifest changed by `edit`.
fn copy(home: &Path, edit: impl FnOnce(&mut Value)) -> PathBuf {
    let dir = home.join("plugins/paper");
    for sub in ["fonts", "images"] {
        fs::create_dir_all(dir.join(sub)).unwrap();
    }
    for file in ["fonts/fixture.woff2", "images/paper.webp"] {
        fs::copy(fixture().join(file), dir.join(file)).unwrap();
    }
    let text = fs::read_to_string(fixture().join("plugin.json")).unwrap();
    let mut manifest: Value = serde_json::from_str(&text).unwrap();
    edit(&mut manifest);
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    dir
}

fn problems(dir: &Path) -> String {
    validate_dir(dir)
        .expect_err("the theme is refused")
        .join("\n")
}

#[test]
fn a_theme_plugin_validates_with_its_assets() {
    let manifest = validate_dir(&fixture()).expect("the fixture theme is valid");
    assert_eq!(manifest.kind, PluginKind::Theme);
    assert_eq!(manifest.entry, None);
    let theme = manifest.theme.expect("a theme plugin has its theme block");
    assert_eq!(theme.shape.and_then(|s| s.radius), Some(ThemeRadius::Round));
    let light = theme.light.expect("a light variant");
    assert_eq!(
        light
            .colors
            .as_ref()
            .and_then(|c| c.get("background"))
            .map(String::as_str),
        Some("#f6f1e7")
    );
    let backdrop = light.backdrop.expect("a backdrop");
    assert_eq!(backdrop.image.as_deref(), Some("images/paper.webp"));
    let fonts = theme.r#type.and_then(|t| t.fonts).unwrap_or_default();
    assert_eq!(fonts.len(), 1);
    assert_eq!(fonts[0].src, "fonts/fixture.woff2");
}

#[test]
fn a_missing_or_oversized_asset_fails() {
    let home = home("theme-assets");

    let dir = copy(&home, |_| {});
    fs::remove_file(dir.join("fonts/fixture.woff2")).unwrap();
    let missing = problems(&dir);
    assert!(
        missing.contains("fonts/fixture.woff2 does not exist"),
        "{missing}"
    );

    let dir = copy(&home, |_| {});
    fs::write(dir.join("images/paper.webp"), vec![0u8; 3 << 20]).unwrap();
    let big = problems(&dir);
    assert!(big.contains("images/paper.webp is 3145728 bytes"), "{big}");

    let dir = copy(&home, |m| {
        m["theme"]["light"]["backdrop"]["image"] = json!("images/paper.svg");
    });
    fs::write(dir.join("images/paper.svg"), "<svg/>").unwrap();
    let svg = problems(&dir);
    assert!(svg.contains("/theme/light/backdrop/image"), "{svg}");

    // Eight 1.5 MiB fonts: each is allowed, together they are over the 8 MiB a theme may bring.
    let dir = copy(&home, |m| {
        let fonts: Vec<Value> = (0..8)
            .map(|i| json!({ "family": format!("F{i}"), "src": format!("fonts/f{i}.woff2") }))
            .collect();
        m["theme"]["type"]["fonts"] = json!(fonts);
    });
    for i in 0..8 {
        fs::write(dir.join(format!("fonts/f{i}.woff2")), vec![0u8; 3 << 19]).unwrap();
    }
    let total = problems(&dir);
    assert!(
        total.contains("over the 8388608 a theme may bring"),
        "{total}"
    );
}

#[test]
fn a_theme_has_no_code() {
    let home = home("theme-no-code");
    for (field, value) in [
        ("entry", json!("theme.js")),
        ("contributes", json!({ "themes": [] })),
        ("permissions", json!([{ "permission": "ui:surface" }])),
    ] {
        let dir = copy(&home, |m| m[field] = value.clone());
        fs::write(dir.join("theme.js"), "").unwrap();
        let refused = problems(&dir);
        assert!(refused.contains("plugin.json"), "{field}: {refused}");
    }
    let dir = copy(&home, |m| {
        m["kind"] = json!("ui");
        m["entry"] = json!("index.html");
    });
    fs::write(dir.join("index.html"), "").unwrap();
    let ui = problems(&dir);
    assert!(
        ui.contains("plugin.json"),
        "a ui plugin carries no theme: {ui}"
    );
    let dir = copy(&home, |m| {
        m.as_object_mut().unwrap().remove("theme");
    });
    let bare = problems(&dir);
    assert!(
        bare.contains("plugin.json"),
        "a theme needs its block: {bare}"
    );
}

#[test]
fn a_theme_is_always_on_and_never_disabled() {
    let home = home("theme-on");
    let store = home.join("plugins.json");
    fs::write(&store, json!({ "enabled": { THEME: false } }).to_string()).unwrap();
    let core = Core::new(roots(&home)).with_plugin_store(store);

    let info = core.install_plugin(&copy(&home, |_| {}), false);
    assert_eq!(info.status, PluginStatus::Ready, "{:?}", info.error);
    assert!(info.enabled, "a stored flag does not hold a theme off");
    let kind = info.manifest.as_ref().map(|m| m.kind);
    assert_eq!(kind, Some(PluginKind::Theme));

    // Its files are served like any plugin's: the runtime loads its fonts and images from here.
    let font = core.plugin_file(THEME, "fonts/fixture.woff2").unwrap();
    assert!(font.starts_with(b"wOF2"));

    grant(&core, "desk", plugin_manage());
    let off = call(
        &core,
        "desk",
        "plugin.setEnabled",
        json!({ "plugin": THEME, "enabled": false, "scope": plugin_manage() }),
    )
    .unwrap_err();
    assert_eq!(off.code, ErrorCode::Unsupported);
    assert!(off.message.contains("desk.theme.active"), "{}", off.message);
    assert!(core.plugins().iter().any(|p| p.id == THEME && p.enabled));
}
