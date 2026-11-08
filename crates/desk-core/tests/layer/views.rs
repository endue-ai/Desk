//! What the view tests share: views and view plugin folders to install, the person's view files,
//! view.* calls as `desk`, plugin.setEnabled, and the view.changed deliveries seen.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use desk_bridge::BridgeError;
use serde_json::{Value, json};

use super::{Desk, view_manage};

/// An agenda over one requires entry.
pub fn view(id: &str, title: &str) -> Value {
    json!({
        "id": id, "version": "0.1.0", "title": title,
        "requires": { "calendar": { "kinds": ["event"] } },
        "layout": {
            "type": "agenda", "range": "day",
            "binding": { "kinds": ["event"], "sources": ["$calendar"] },
            "fields": [{ "value": "{start|time} {title}" }],
        },
    })
}

pub fn yaml(view: &Value) -> String {
    yaml_serde::to_string(view).unwrap()
}

/// A kind `view` plugin `id` in its own folder under `parent`: `fields` join id, version and kind,
/// and `files` are written beside plugin.json.
pub fn plugin(parent: &Path, id: &str, fields: Value, files: &[(&str, String)]) -> PathBuf {
    let dir = parent.join(id);
    fs::create_dir_all(&dir).unwrap();
    for (path, text) in files {
        fs::create_dir_all(dir.join(path).parent().unwrap()).unwrap();
        fs::write(dir.join(path), text).unwrap();
    }
    let mut manifest = json!({ "id": id, "version": "0.1.0", "kind": "view" });
    for (key, value) in fields.as_object().unwrap() {
        manifest[key] = value.clone();
    }
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    dir
}

/// The person's file `~/.desk/views/<id>.yaml`.
pub fn file(desk: &Desk, id: &str) -> PathBuf {
    desk.home.join(format!(".desk/views/{id}.yaml"))
}

pub fn write_file(desk: &Desk, view: &Value) {
    let path = file(desk, view["id"].as_str().unwrap());
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, yaml(view)).unwrap();
}

pub fn call(desk: &Desk, method: &str, params: Value) -> Result<Value, BridgeError> {
    let mut params = params;
    params["scope"] = view_manage();
    desk.call("desk", method, params)
}

pub fn list(desk: &Desk) -> Value {
    call(desk, "view.list", json!({})).unwrap()["views"].clone()
}

pub fn ids(desk: &Desk) -> Vec<String> {
    let views = list(desk);
    let ids = views.as_array().unwrap().iter();
    ids.map(|v| v["id"].as_str().unwrap().to_owned()).collect()
}

pub fn get(desk: &Desk, id: &str) -> Result<Value, BridgeError> {
    call(desk, "view.get", json!({ "id": id }))
}

pub fn set_enabled(desk: &Desk, plugin: &str, enabled: bool) {
    let scope = json!({ "permission": "plugin:manage" });
    let params = json!({ "plugin": plugin, "enabled": enabled, "scope": scope });
    desk.ok("desk", "plugin.setEnabled", params);
}

/// The view.changed deliveries so far, each as (its recipients, its data), in id order.
pub fn changed(desk: &Desk) -> Vec<(Option<Vec<String>>, Value)> {
    let mut seen = desk.named("view.changed", Duration::from_millis(100));
    for (_, event) in &mut seen {
        *event = event["data"].take();
    }
    seen.sort_by_key(|(_, data)| data["id"].as_str().unwrap().to_owned());
    seen
}

pub fn to_desk(changes: &[(&str, &str)]) -> Vec<(Option<Vec<String>>, Value)> {
    let to = Some(vec!["desk".to_owned()]);
    let data = |(id, change): &(&str, &str)| json!({ "id": id, "change": change });
    changes.iter().map(|c| (to.clone(), data(c))).collect()
}

/// Replace `dir`'s plugin.json in one rename, so the watcher never reads it half written.
pub fn rewrite_manifest(dir: &Path, text: &str) {
    let staged = dir.join(".plugin.json.new");
    fs::write(&staged, text).unwrap();
    fs::rename(staged, dir.join("plugin.json")).unwrap();
}

/// The next `count` view.changed deliveries, as a set of (recipients, id, change).
pub fn next_changes(desk: &Desk, count: usize) -> BTreeSet<(String, String, String)> {
    (0..count)
        .map(|_| {
            let (to, data) = desk.wait_for("view.changed");
            let (id, change) = (
                data["id"].as_str().unwrap(),
                data["change"].as_str().unwrap(),
            );
            (to.unwrap().join(","), id.to_owned(), change.to_owned())
        })
        .collect()
}

pub fn set(changes: &[(&str, &str)]) -> BTreeSet<(String, String, String)> {
    changes
        .iter()
        .map(|(id, c)| ("desk".to_owned(), id.to_string(), c.to_string()))
        .collect()
}
