//! User themes (ADR 0058): theme plugins in the core's user themes folder, kept with theme.* under
//! theme:manage. Nothing lands unless it checks out as a theme plugin; built-in ids and other plugins
//! are never replaced. URLs go through a fetch the test gives, never the network.

mod support;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use desk_bridge::{BridgeError, ErrorCode};
use desk_core::Core;
use desk_update::verify::sha256_hex;
use serde_json::{Value, json};
use support::{call, grant, home, named, plugin_manage, roots, wait_for};

const RUNTIME: &str = "desk";
const FONT: &[u8] = b"wOF2 a user theme's font";
const IMAGE: &[u8] = b"\x89PNG a user theme's backdrop";
const URL: &str = "https://themes.example.com/paper.desk-theme";
const PAPER: &str = "local.my-paper";

fn themes(home: &Path) -> PathBuf {
    home.join("data/themes")
}

/// The runtime holds theme:manage and plugin:manage, as the app grants them.
fn granted(core: Core) -> Core {
    grant(&core, RUNTIME, json!({ "permission": "theme:manage" }));
    grant(&core, RUNTIME, plugin_manage());
    core
}

fn desk(home: &Path) -> Core {
    granted(Core::new(roots(home)).with_themes_dir(themes(home)))
}

/// A user theme's manifest: a font and a light backdrop image.
fn manifest(id: &str) -> Value {
    json!({
        "id": id, "name": "My Paper", "version": "1.0.0", "kind": "theme",
        "theme": {
            "type": { "sans": "\"Mine\", serif", "fonts": [{ "family": "Mine", "src": "fonts/mine.woff2" }] },
            "light": { "colors": { "background": "#f6f1e7" }, "backdrop": { "image": "images/paper.png" } }
        }
    })
}

fn file(path: &str, bytes: &[u8]) -> Value {
    json!({ "path": path, "base64": STANDARD.encode(bytes) })
}

fn files() -> Value {
    let font = file("fonts/mine.woff2", FONT);
    json!([font, file("images/paper.png", IMAGE)])
}

fn bundle(manifest: Value) -> Value {
    let files = json!({ "fonts/mine.woff2": STANDARD.encode(FONT), "images/paper.png": STANDARD.encode(IMAGE) });
    json!({ "format": "desk-theme/1", "manifest": manifest, "files": files })
}

/// theme.<method> as the runtime, under its theme:manage scope.
fn theme(core: &Core, method: &str, mut params: Value) -> Answer {
    params["scope"] = json!({ "permission": "theme:manage" });
    call(core, RUNTIME, &format!("theme.{method}"), params)
}

type Answer = Result<Value, BridgeError>;
const INVALID: ErrorCode = ErrorCode::InvalidParams;
const MISSING: ErrorCode = ErrorCode::NotFound;

fn save(core: &Core, manifest: Value, files: Value) -> Answer {
    let params = json!({ "manifest": manifest, "files": files });
    theme(core, "save", params)
}

fn import(core: &Core, params: Value) -> Answer {
    theme(core, "import", params)
}

fn export(core: &Core, params: Value) -> Answer {
    theme(core, "export", params)
}

fn remove(core: &Core, id: &str) -> Answer {
    theme(core, "remove", json!({ "theme": id }))
}

fn code(answer: Answer) -> ErrorCode {
    answer.expect_err("the call is refused").code
}

fn installed(core: &Core, id: &str) -> bool {
    built_in(core, id).is_some()
}

/// Whether `id` is installed built in, not built in, or not at all (`None`).
fn built_in(core: &Core, id: &str) -> Option<bool> {
    let plugin = core.plugins().into_iter().find(|p| p.id == id);
    plugin.map(|p| p.built_in)
}

fn read(path: PathBuf) -> Vec<u8> {
    fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn read_json(path: PathBuf) -> Value {
    serde_json::from_slice(&read(path)).unwrap()
}

fn entries(home: &Path) -> usize {
    fs::read_dir(themes(home)).unwrap().count()
}

fn changed(id: &str, change: &str, revision: u64) -> Value {
    json!({ "plugin": id, "change": change, "revision": revision })
}

/// The fixture theme (`tests/fixtures/theme`: a font and a backdrop image) as the built-in `id`.
fn install_fixture(core: &Core, home: &Path, id: &str) -> PathBuf {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/theme");
    let dir = home.join("builtin").join(id);
    for file in ["fonts/fixture.woff2", "images/paper.webp"] {
        fs::create_dir_all(dir.join(file).parent().unwrap()).unwrap();
        fs::copy(fixture.join(file), dir.join(file)).unwrap();
    }
    let mut manifest = read_json(fixture.join("plugin.json"));
    manifest["id"] = json!(id);
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    assert!(core.install_plugin(&dir, true).error.is_none());
    dir
}

#[test]
fn save_writes_installs_and_announces_a_theme_and_a_second_save_replaces_it() {
    let home = home("themes-save");
    let core = desk(&home);
    let deliveries = core.events().subscribe_addressed();
    let plugin = save(&core, manifest(PAPER), files()).unwrap()["plugin"].clone();
    assert_eq!(plugin["status"], "ready");
    assert_eq!(plugin["builtIn"], false);
    let dir = themes(&home).join(PAPER);
    assert_eq!(read(dir.join("fonts/mine.woff2")), FONT);
    assert_eq!(read(dir.join("images/paper.png")), IMAGE);
    assert_eq!(read_json(dir.join("plugin.json")), manifest(PAPER));
    let seen = named(&deliveries, "plugin.changed");
    assert_eq!(seen[0].data(), &changed(PAPER, "installed", 1));
    // A second save replaces the folder whole.
    let mut warmer = manifest(PAPER);
    warmer["theme"]["light"]["backdrop"] = json!({ "color": "#efe4cf" });
    let font = json!([file("fonts/mine.woff2", FONT)]);
    let again = save(&core, warmer.clone(), font).unwrap();
    assert_eq!(again["plugin"]["manifest"], warmer);
    assert!(!dir.join("images").exists());
    assert_eq!(core.plugins().iter().filter(|p| p.id == PAPER).count(), 1);
    let seen = named(&deliveries, "plugin.changed");
    assert_eq!(seen[0].data(), &changed(PAPER, "updated", 2));
}

#[test]
fn an_invalid_save_leaves_nothing_behind() {
    let home = home("themes-invalid");
    let core = desk(&home);
    let font = json!([file("fonts/mine.woff2", FONT)]);
    let missing = save(&core, manifest("local.broken"), font).unwrap_err();
    assert_eq!(missing.code, INVALID);
    let why = missing.message;
    assert!(why.contains("images/paper.png does not exist"), "{why}");
    assert_eq!(entries(&home), 0, "no folder and no staging left");
    assert!(!installed(&core, "local.broken"));
    save(&core, manifest(PAPER), files()).unwrap();
    let mut bad = manifest(PAPER);
    bad["theme"]["light"]["colors"]["background"] = json!("url(x.png)");
    assert_eq!(code(save(&core, bad, files())), INVALID);
    let kept = read_json(themes(&home).join(PAPER).join("plugin.json"));
    assert_eq!(kept, manifest(PAPER));
    assert_eq!(entries(&home), 1);
    // Saved ids are inside local., and every file is one the theme names.
    let outside = save(&core, manifest("example.mine"), files());
    assert_eq!(code(outside), INVALID);
    let mut extra = files();
    let more = file("images/more.png", IMAGE);
    extra.as_array_mut().unwrap().push(more);
    let unnamed = save(&core, manifest("local.extra"), extra);
    assert_eq!(code(unnamed), INVALID);
}

#[test]
fn copy_from_brings_the_files_the_saved_theme_names() {
    let home = home("themes-copy");
    let core = desk(&home);
    let source = install_fixture(&core, &home, "example.paper");
    let mut copy = manifest("local.paper-copy");
    copy["theme"]["type"]["fonts"][0]["src"] = json!("fonts/fixture.woff2");
    copy["theme"]["light"]["backdrop"]["image"] = json!("images/paper.webp");
    let from = |manifest: &Value, files: Value| {
        let from = "example.paper";
        let params = json!({ "manifest": manifest, "files": files, "copyFrom": from });
        theme(&core, "save", params)
    };
    let saved = from(&copy, json!([])).unwrap();
    assert_eq!(saved["plugin"]["status"], "ready");
    let dir = themes(&home).join("local.paper-copy");
    let (font, image) = ("fonts/fixture.woff2", "images/paper.webp");
    assert_eq!(read(dir.join(font)), read(source.join(font)));
    assert_eq!(read(dir.join(image)), read(source.join(image)));
    from(&copy, json!([file(font, FONT)])).unwrap();
    assert_eq!(read(dir.join(font)), FONT);
    assert_eq!(read(dir.join(image)), read(source.join(image)));
    let mut font_only = copy.clone();
    font_only["theme"]["light"]["backdrop"] = json!({ "color": "#f6f1e7" });
    from(&font_only, json!([])).unwrap();
    assert!(!dir.join("images").exists(), "only the files it names");
    support::install_hello(&core, &home);
    for other in ["example.nothing", "example.hello"] {
        let params = json!({ "manifest": copy, "copyFrom": other });
        assert_eq!(code(theme(&core, "save", params)), MISSING, "{other}");
    }
}

#[test]
fn import_reads_a_bundle_file_and_moves_a_foreign_id_inside_local() {
    let home = home("themes-import");
    let core = desk(&home);
    let mut foreign = manifest("endue.theme-paper");
    foreign["name"] = json!("Paper & Ink");
    fs::write(home.join("paper.desk-theme"), bundle(foreign).to_string()).unwrap();
    let path = json!({ "path": "~/paper.desk-theme" });
    let plugin = import(&core, path.clone()).unwrap()["plugin"].clone();
    assert_eq!(plugin["id"], "local.paper-ink");
    assert_eq!(plugin["manifest"]["name"], "Paper & Ink");
    let landed = themes(&home).join("local.paper-ink/fonts/mine.woff2");
    assert_eq!(read(landed), FONT);
    let market = import(&core, json!({ "bundle": bundle(manifest("market.ember")) }));
    assert_eq!(market.unwrap()["plugin"]["id"], "market.ember");
    let mut other = bundle(manifest("local.other"));
    other["format"] = json!("desk-theme/2");
    fs::write(home.join("other.desk-theme"), other.to_string()).unwrap();
    let wrong = json!({ "path": "~/other.desk-theme" });
    assert_eq!(code(import(&core, wrong)), INVALID);
    let mut both = path;
    both["bundle"] = bundle(manifest("local.x"));
    assert_eq!(code(import(&core, both)), INVALID);
    assert!(!installed(&core, "local.other") && !installed(&core, "local.x"));
}

#[test]
fn import_by_url_checks_the_sha256() {
    let home = home("themes-url");
    let bytes = bundle(manifest("local.from-url")).to_string();
    let sha256 = sha256_hex(bytes.as_bytes());
    let asked = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&asked);
    let fetch = move |url: &str| {
        counter.fetch_add(1, Ordering::SeqCst);
        let found = (url == URL).then(|| bytes.clone().into_bytes());
        found.ok_or_else(|| format!("{url}: 404"))
    };
    let core = Core::new(roots(&home)).with_themes_dir(themes(&home));
    let core = granted(core.with_theme_fetch(Box::new(fetch)));
    let wrong = json!({ "url": URL, "sha256": sha256_hex(b"another file") });
    let mismatch = import(&core, wrong).unwrap_err();
    assert_eq!(mismatch.code, INVALID);
    assert!(mismatch.message.contains("sha256"), "{}", mismatch.message);
    assert_eq!(entries(&home), 0);
    assert!(!installed(&core, "local.from-url"));
    let http = URL.replace("https:", "http:");
    let plain = json!({ "url": http, "sha256": sha256 });
    assert_eq!(code(import(&core, plain)), INVALID);
    assert_eq!(code(import(&core, json!({ "url": URL }))), INVALID);
    assert_eq!(asked.load(Ordering::SeqCst), 1);
    let right = import(&core, json!({ "url": URL, "sha256": sha256 }));
    assert_eq!(right.unwrap()["plugin"]["id"], "local.from-url");
    let gone = json!({ "url": format!("{URL}x"), "sha256": sha256 });
    assert_eq!(code(import(&core, gone)), ErrorCode::IoError);
}

#[test]
fn export_then_import_round_trips_byte_for_byte() {
    let home = home("themes-export");
    let core = desk(&home);
    save(&core, manifest(PAPER), files()).unwrap();
    let to = |path: &str| json!({ "theme": PAPER, "path": path });
    let first = export(&core, to("~/out/first.desk-theme")).unwrap();
    let path = home.join("out").join("first.desk-theme");
    assert_eq!(first, json!({ "path": path.to_string_lossy() }));
    let first = read(path);
    let inline = export(&core, json!({ "theme": PAPER, "inline": true }));
    let inline = inline.unwrap();
    let parsed: Value = serde_json::from_slice(&first).unwrap();
    assert_eq!(inline["bundle"], parsed);
    assert_eq!(inline["bundle"], bundle(manifest(PAPER)));
    let downloads = home.join("Downloads");
    for name in ["local.my-paper", "local.my-paper-2"] {
        let written = export(&core, json!({ "theme": PAPER })).unwrap();
        let file = downloads.join(format!("{name}.desk-theme"));
        assert_eq!(written["path"], json!(file.to_string_lossy()));
    }
    remove(&core, PAPER).unwrap();
    import(&core, json!({ "path": "~/out/first.desk-theme" })).unwrap();
    export(&core, to("~/out/second.desk-theme")).unwrap();
    assert_eq!(read(home.join("out/second.desk-theme")), first);
    let source = install_fixture(&core, &home, "example.paper");
    let builtin = export(&core, json!({ "theme": "example.paper", "inline": true })).unwrap();
    let font = STANDARD.encode(read(source.join("fonts/fixture.woff2")));
    assert_eq!(builtin["bundle"]["files"]["fonts/fixture.woff2"], font);
    support::install_hello(&core, &home);
    for id in ["example.hello", "example.nothing"] {
        let refused = export(&core, json!({ "theme": id, "inline": true }));
        assert_eq!(code(refused), MISSING, "{id}");
    }
}

#[test]
fn built_in_themes_are_never_replaced_or_removed_and_user_themes_are() {
    let home = home("themes-remove");
    let core = desk(&home);
    save(&core, manifest(PAPER), files()).unwrap();
    let builtin = install_fixture(&core, &home, "local.paper");
    let deliveries = core.events().subscribe_addressed();
    let saved = save(&core, manifest("local.paper"), files());
    assert_eq!(code(saved), ErrorCode::AlreadyExists);
    let bundled = json!({ "bundle": bundle(manifest("local.paper")) });
    assert_eq!(code(import(&core, bundled)), ErrorCode::AlreadyExists);
    assert_eq!(code(remove(&core, "local.paper")), INVALID);
    assert!(!themes(&home).join("local.paper").exists());
    assert!(builtin.join("plugin.json").is_file());
    assert_eq!(built_in(&core, "local.paper"), Some(true));
    assert_eq!(code(remove(&core, "local.nothing")), MISSING);
    assert_eq!(remove(&core, PAPER).unwrap(), json!({}));
    assert!(!themes(&home).join(PAPER).exists());
    assert!(!installed(&core, PAPER));
    let seen = named(&deliveries, "plugin.changed");
    assert_eq!(seen[0].data(), &changed(PAPER, "removed", 1));
}

#[test]
fn a_caller_without_theme_manage_is_refused() {
    let home = home("themes-denied");
    let core = desk(&home);
    save(&core, manifest(PAPER), files()).unwrap();
    grant(&core, "example.notes", plugin_manage());
    let scope = json!({ "permission": "theme:manage" });
    let mine = manifest("local.mine");
    for (method, mut params) in [
        ("save", json!({ "manifest": mine, "files": files() })),
        ("import", json!({ "bundle": bundle(mine.clone()) })),
        ("export", json!({ "theme": PAPER, "inline": true })),
        ("remove", json!({ "theme": PAPER })),
    ] {
        params["scope"] = scope.clone();
        let method = format!("theme.{method}");
        let refused = call(&core, "example.notes", &method, params).unwrap_err();
        assert_eq!(refused.code, ErrorCode::PermissionDenied, "{method}");
        let permission = serde_json::to_value(refused.permission).unwrap();
        assert_eq!(permission, scope);
    }
    assert!(installed(&core, PAPER) && !installed(&core, "local.mine"));
}

#[test]
fn user_themes_load_at_start_and_the_folder_is_watched() {
    let home = home("themes-start");
    let write = |folder: &str, manifest: Value| {
        let dir = themes(&home).join(folder);
        for (path, bytes) in [("fonts/mine.woff2", FONT), ("images/paper.png", IMAGE)] {
            fs::create_dir_all(dir.join(path).parent().unwrap()).unwrap();
            fs::write(dir.join(path), bytes).unwrap();
        }
        fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    };
    write("kept", manifest("local.kept"));
    write("foreign", manifest("example.foreign"));
    let library = json!({ "id": "local.library", "version": "0.1.0", "kind": "library" });
    write("library", library);
    write(".saving-local.half", manifest("local.half"));
    let core = Arc::new(desk(&home));
    assert_eq!(built_in(&core, "local.kept"), Some(false));
    for id in ["example.foreign", "local.library", "local.half"] {
        assert!(!installed(&core, id), "{id} is not a user theme");
    }
    let deliveries = core.events().subscribe_addressed();
    let _watcher = core.watch_themes().expect("the watch starts");
    save(&core, manifest(PAPER), files()).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(400));
    let once = named(&deliveries, "plugin.changed");
    assert_eq!(once.len(), 1, "the core's own write is announced once");
    write("dropped", manifest("local.dropped"));
    let added = wait_for(&deliveries, "plugin.changed").data().clone();
    assert_eq!(added["plugin"], "local.dropped");
    assert_eq!(added["change"], "installed");
    fs::remove_dir_all(themes(&home).join("dropped")).unwrap();
    let gone = wait_for(&deliveries, "plugin.changed").data().clone();
    assert_eq!(gone["plugin"], "local.dropped");
    assert_eq!(gone["change"], "removed");
}
