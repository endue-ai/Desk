//! Removing a plugin takes everything its connectors held (issue 338): an http connector's instances,
//! the token in secrets.json, its records in the store and its items in the index; a Wasm connector's
//! instances, secrets, records and cursors too; and a pack's nested connectors with the pack. A plugin
//! installed later under the same id starts empty, so the old token can never reach its host. An
//! install over the plugin (an update) keeps all of it, as before. Syncs run on an explicit tick and
//! a fake clock; the servers are fixtures on 127.0.0.1.

mod github;
mod layer;

use std::fs;
use std::path::Path;

use github::{Server, plugin_copy, serve};
use layer::fixtures::{hello, write_at};
use layer::{DAY, Desk, HELLO, NOW};
use serde_json::{Value, json};

const GITHUB: &str = "desk.github";
const TOKEN: &str = "ghp_fixtureToken0123456789abcdef";
const PACK: &str = "acme.pack";

/// The secrets file as JSON; an empty object when there is none.
fn secrets(desk: &Desk) -> Value {
    fs::read_to_string(desk.data.join("secrets.json"))
        .map(|text| serde_json::from_str(&text).unwrap())
        .unwrap_or_else(|_| json!({}))
}

/// Whether the secrets file names an instance of `connector`.
fn holds_secrets(desk: &Desk, connector: &str) -> bool {
    let all = secrets(desk);
    let prefix = format!("{connector}/");
    all["secrets"]
        .as_object()
        .is_some_and(|s| s.keys().any(|k| k.starts_with(&prefix)))
}

/// The keys the store file holds under `caller`.
fn stored_keys(desk: &Desk, caller: &str) -> Vec<String> {
    let Ok(text) = fs::read_to_string(desk.data.join("store.json")) else {
        return Vec::new();
    };
    let all: Value = serde_json::from_str(&text).unwrap();
    all[caller]
        .as_object()
        .map(|keys| keys.keys().cloned().collect())
        .unwrap_or_default()
}

fn items_of(desk: &Desk, connector: &str, instance: &str) -> Vec<Value> {
    let sources = [format!("{connector}/{instance}")];
    desk.items(json!({ "sources": sources, "limit": 100 }))
}

/// A desk with the copy of plugins/github installed (its net:fetch grant from the manifest), its
/// `work` instance connected with the token and synced once.
fn connected(tag: &str) -> (Desk, Server) {
    let server = serve(TOKEN);
    let desk = Desk::new(tag, None);
    let dir = plugin_copy(&desk.home.join("plugins"), &server, |_| {});
    desk.core.install_plugin(&dir, true);
    connect(&desk, GITHUB);
    desk.tick();
    (desk, server)
}

fn connect(desk: &Desk, connector: &str) {
    let settings = json!({ "token": TOKEN });
    let params = json!({ "connector": connector, "instance": "work", "title": "Work", "settings": settings });
    desk.connect(params).unwrap();
}

/// Everything the connector holds, as the tests check it: its instances, secrets, store keys, items.
fn assert_holds(desk: &Desk, connector: &str, held: bool) {
    let instances = desk.instances(connector);
    assert_eq!(!instances.is_empty(), held, "instances: {instances:?}");
    assert_eq!(holds_secrets(desk, connector), held, "{}", secrets(desk));
    let keys = stored_keys(desk, connector);
    assert_eq!(!keys.is_empty(), held, "store keys: {keys:?}");
    let items = items_of(desk, connector, "work");
    assert_eq!(!items.is_empty(), held, "{} items", items.len());
}

#[test]
fn a_removed_http_connector_leaves_no_instance_secret_or_item() {
    let (desk, _server) = connected("remove-secrets-http");
    assert_holds(&desk, GITHUB, true);

    assert!(desk.core.remove_plugin(GITHUB));
    assert!(!holds_secrets(&desk, GITHUB), "{}", secrets(&desk));
    assert!(
        !fs::read_to_string(desk.data.join("secrets.json"))
            .unwrap_or_default()
            .contains(TOKEN)
    );
    assert_eq!(stored_keys(&desk, GITHUB), Vec::<String>::new());
    assert!(items_of(&desk, GITHUB, "work").is_empty());
}

#[test]
fn a_plugin_installed_later_under_the_same_id_never_gets_the_old_token() {
    let (desk, first) = connected("remove-secrets-later");
    assert!(desk.core.remove_plugin(GITHUB));
    let before = first.seen().len();

    // Another plugin under the same id, its base URL at another server, its host granted.
    let other = serve("another-token");
    let dir = plugin_copy(&desk.home.join("elsewhere"), &other, |_| {});
    desk.core.install_plugin(&dir, false);
    let host = format!("127.0.0.1:{}", other.port);
    desk.grant(
        GITHUB,
        json!({ "permission": "net:fetch", "hosts": [host] }),
    );
    assert!(desk.instances(GITHUB).is_empty(), "no instance comes back");
    desk.clock.advance(3600);
    desk.tick();
    desk.clock.advance(3600);
    desk.tick();
    assert!(
        other.seen().is_empty(),
        "nothing reached the new host: {:?}",
        other.seen()
    );
    assert_eq!(first.seen().len(), before, "nor the old one");
    let restarted = desk.restart(None);
    let dir = plugin_copy(&restarted.home.join("elsewhere"), &other, |_| {});
    restarted.core.install_plugin(&dir, false);
    assert!(
        restarted.instances(GITHUB).is_empty(),
        "nor after a restart"
    );
}

#[test]
fn a_removed_wasm_connectors_instances_and_secrets_go() {
    let desk = Desk::new("remove-secrets-wasm", None);
    write_at(&desk.home.join("Notes/alpha.md"), "# Alpha", NOW - DAY);
    hello(&desk, true, |m| {
        let token = json!({ "kind": "string", "title": "Token", "secret": true });
        m["connector"]["instanceSettings"]["token"] = token;
    });
    let settings = json!({ "folder": "~/Notes", "token": "s3cret-t0ken" });
    desk.connect(json!({ "connector": HELLO, "instance": "notes", "settings": settings }))
        .unwrap();
    desk.tick();
    assert!(holds_secrets(&desk, HELLO));
    assert!(!stored_keys(&desk, HELLO).is_empty());
    assert!(!items_of(&desk, HELLO, "notes").is_empty());

    assert!(desk.core.remove_plugin(HELLO));
    assert!(!holds_secrets(&desk, HELLO), "{}", secrets(&desk));
    assert_eq!(stored_keys(&desk, HELLO), Vec::<String>::new());
    assert!(items_of(&desk, HELLO, "notes").is_empty());

    hello(&desk, true, |_| {});
    assert!(desk.instances(HELLO).is_empty(), "a new one starts empty");
}

#[test]
fn an_update_in_place_keeps_instances_secrets_and_store() {
    let (desk, server) = connected("remove-secrets-update");
    let dir = plugin_copy(&desk.home.join("plugins"), &server, |m| {
        m["version"] = json!("9.9.9");
    });
    desk.core.install_plugin(&dir, true);
    assert_holds(&desk, GITHUB, true);
    let before = server.seen().len();
    desk.clock.advance(3600);
    desk.tick();
    assert!(server.seen().len() > before, "it syncs with its token");
}

/// A pack folder at `parent/acme` with the github connector copy nested under `plugins/`.
fn pack_dir(parent: &Path, server: &Server) -> std::path::PathBuf {
    let dir = parent.join("acme");
    fs::create_dir_all(&dir).unwrap();
    let manifest = json!({
        "id": PACK, "name": "Acme", "version": "0.1.0", "kind": "pack",
        "pack": { "services": ["acme"], "plugins": [GITHUB] }
    });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    plugin_copy(&dir.join("plugins"), server, |_| {});
    dir
}

#[test]
fn a_pack_removal_clears_its_nested_connectors() {
    let server = serve(TOKEN);
    let desk = Desk::new("remove-secrets-pack", None);
    desk.core
        .install_plugin(&pack_dir(&desk.home.join("plugins"), &server), false);
    let host = format!("127.0.0.1:{}", server.port);
    desk.grant(
        GITHUB,
        json!({ "permission": "net:fetch", "hosts": [host] }),
    );
    connect(&desk, GITHUB);
    desk.tick();
    assert_holds(&desk, GITHUB, true);

    assert!(desk.core.remove_plugin(PACK));
    assert!(!holds_secrets(&desk, GITHUB), "{}", secrets(&desk));
    assert_eq!(stored_keys(&desk, GITHUB), Vec::<String>::new());
    assert!(items_of(&desk, GITHUB, "work").is_empty());
}
