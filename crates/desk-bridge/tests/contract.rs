//! Contract: the bridge, plugin, item, view, connector and init vectors are judged by the JSON Schemas
//! (and, for views and manifests, the rules the schemas cannot say) exactly as their folders say, and
//! every valid vector round-trips through the generated Rust types unchanged.

use std::fs;
use std::path::{Path, PathBuf};

use desk_bridge::{
    BridgeEvent, BridgeRequest, BridgeResponse, ConnectorInstance, ConnectorManifest,
    ConnectorStatus, ConnectorSyncResult, InitDocument, InitGetResult, InitSettingKey, Item,
    ItemChange, ItemPage, ItemQuery, PermQueryResult, Permission, PluginContributes,
    PluginListResult, PluginManifest, StoreGetResult, View, manifest_problems, view_problems,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

fn specs() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../specs")
}

fn read_json(path: &Path) -> Value {
    let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// The plugin manifest and the specs it references, which reference it back: one set of documents.
fn plugin_schemas() -> Vec<Value> {
    ["plugin/v0", "item/v0", "view/v0", "connector/v0"]
        .iter()
        .flat_map(|folder| schemas(folder))
        .collect()
}

fn schemas(folder: &str) -> Vec<Value> {
    let mut paths: Vec<PathBuf> = fs::read_dir(specs().join(folder))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.to_string_lossy().ends_with(".schema.json"))
        .collect();
    paths.sort();
    paths.iter().map(|path| read_json(path)).collect()
}

struct Vector {
    file: String,
    valid: bool,
    target: String,
    instance: Value,
}

fn vectors(spec: &str) -> Vec<Vector> {
    let mut out = Vec::new();
    for (kind, valid) in [("valid", true), ("invalid", false)] {
        let dir = specs().join(spec).join("v0/vectors").join(kind);
        let mut paths: Vec<PathBuf> = fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        paths.sort();
        for path in paths {
            let mut doc = read_json(&path);
            out.push(Vector {
                file: format!(
                    "{spec}/{kind}/{}",
                    path.file_name().unwrap().to_string_lossy()
                ),
                valid,
                target: doc["target"].as_str().unwrap().to_owned(),
                instance: doc["instance"].take(),
            });
        }
    }
    out
}

/// The rules a schema cannot say: the names a view or a manifest uses must resolve inside it.
fn names_resolve(target: &str, instance: &Value) -> bool {
    match target {
        "View" => serde_json::from_value::<View>(instance.clone())
            .is_ok_and(|view| view_problems(&view).is_empty()),
        "PluginManifest" => serde_json::from_value::<PluginManifest>(instance.clone())
            .is_ok_and(|manifest| manifest_problems(&manifest).is_empty()),
        _ => true,
    }
}

/// Validate every vector of `spec` against `docs`; returns the files judged differently.
fn judge(docs: &[Value], spec: &str) -> Vec<String> {
    let registry = jsonschema::Registry::new()
        .extend(
            docs.iter()
                .map(|doc| (doc["$id"].as_str().unwrap().to_owned(), doc.clone())),
        )
        .unwrap()
        .prepare()
        .unwrap();
    let uri_of = |target: &str| {
        docs.iter()
            .find(|doc| doc["$defs"].get(target).is_some())
            .map(|doc| format!("{}#/$defs/{target}", doc["$id"].as_str().unwrap()))
            .unwrap_or_else(|| panic!("no definition named {target}"))
    };
    let mut wrong = Vec::new();
    for vector in vectors(spec) {
        let validator = jsonschema::options()
            .with_registry(&registry)
            .should_validate_formats(false)
            .build(&json!({ "$ref": uri_of(&vector.target) }))
            .unwrap();
        let valid =
            validator.is_valid(&vector.instance) && names_resolve(&vector.target, &vector.instance);
        if valid != vector.valid {
            wrong.push(vector.file);
        }
    }
    wrong
}

#[test]
fn bridge_vectors_are_judged_as_their_folder_says() {
    let mut docs = plugin_schemas();
    docs.extend(schemas("bridge/v0"));
    assert_eq!(judge(&docs, "bridge"), Vec::<String>::new());
}

#[test]
fn plugin_vectors_are_judged_as_their_folder_says() {
    assert_eq!(judge(&plugin_schemas(), "plugin"), Vec::<String>::new());
}

#[test]
fn init_vectors_are_judged_as_their_folder_says() {
    let mut docs = plugin_schemas();
    docs.extend(schemas("init/v0"));
    assert_eq!(judge(&docs, "init"), Vec::<String>::new());
}

#[test]
fn item_view_and_connector_vectors_are_judged_as_their_folders_say() {
    let docs = plugin_schemas();
    for spec in ["item", "view", "connector"] {
        let all = vectors(spec);
        let valid = all.iter().filter(|v| v.valid).count();
        assert!(
            valid >= 5 && all.len() - valid >= 5,
            "{spec}: too few vectors"
        );
        assert_eq!(judge(&docs, spec), Vec::<String>::new(), "{spec}");
        for vector in all.iter().filter(|v| v.valid) {
            match vector.target.as_str() {
                "Item" => roundtrip::<Item>(vector),
                "ItemQuery" => roundtrip::<ItemQuery>(vector),
                "ItemPage" => roundtrip::<ItemPage>(vector),
                "ItemChange" => roundtrip::<ItemChange>(vector),
                "View" => roundtrip::<View>(vector),
                "ConnectorManifest" => roundtrip::<ConnectorManifest>(vector),
                "ConnectorInstance" => roundtrip::<ConnectorInstance>(vector),
                "ConnectorStatus" => roundtrip::<ConnectorStatus>(vector),
                "ConnectorSyncResult" => roundtrip::<ConnectorSyncResult>(vector),
                other => panic!("{}: no Rust type mapped for {other}", vector.file),
            }
        }
    }
}

#[test]
fn the_rules_beyond_the_schemas_name_what_does_not_resolve() {
    let view: View = serde_json::from_value(json!({
        "id": "example.mail", "version": "0.1.0", "title": "Last {params.days} days",
        "requires": { "calendar": { "kinds": ["event"] } },
        "layout": { "type": "list", "binding": { "sources": ["$calendar", "$mail"] } }
    }))
    .unwrap();
    assert_eq!(
        view_problems(&view),
        [
            "/layout/binding/sources/1: $mail is not one of the view's requires",
            "/title: {params.days} reads a param the view does not declare",
        ]
    );
    let manifest: PluginManifest = serde_json::from_value(json!({
        "id": "example.tasks", "version": "0.1.0", "kind": "connector", "entry": "c.wasm",
        "contributes": { "commands": [{ "id": "example.tasks.done", "title": "Done" }] },
        "connector": {
            "binding": "wasm", "auth": { "kind": "none" }, "sync": { "mode": "pull" },
            "resources": [
                { "kind": "task", "actions": ["example.tasks.done", "example.tasks.move"] }
            ]
        }
    }))
    .unwrap();
    assert_eq!(
        manifest_problems(&manifest),
        ["/connector/resources/0/actions/1: example.tasks.move is not in contributes.commands"]
    );
}

fn roundtrip<T: DeserializeOwned + Serialize>(vector: &Vector) {
    let typed: T = serde_json::from_value(vector.instance.clone())
        .unwrap_or_else(|e| panic!("{} does not deserialize: {e}", vector.file));
    let back = serde_json::to_value(&typed).unwrap();
    assert_eq!(
        back, vector.instance,
        "{} changed in a round trip",
        vector.file
    );
}

#[test]
fn valid_vectors_roundtrip_through_generated_types() {
    for spec in ["bridge", "plugin", "init"] {
        for vector in vectors(spec).iter().filter(|v| v.valid) {
            match vector.target.as_str() {
                "BridgeRequest" => roundtrip::<BridgeRequest>(vector),
                "BridgeResponse" => roundtrip::<BridgeResponse>(vector),
                "BridgeEvent" => roundtrip::<BridgeEvent>(vector),
                "PermQueryResult" => roundtrip::<PermQueryResult>(vector),
                "PluginListResult" => roundtrip::<PluginListResult>(vector),
                "StoreGetResult" => roundtrip::<StoreGetResult>(vector),
                "PluginManifest" => roundtrip::<PluginManifest>(vector),
                "Permission" => roundtrip::<Permission>(vector),
                "InitDocument" => roundtrip::<InitDocument>(vector),
                "InitSettingKey" => roundtrip::<InitSettingKey>(vector),
                "InitGetResult" => roundtrip::<InitGetResult>(vector),
                "PluginContributes" => roundtrip::<PluginContributes>(vector),
                other => panic!("{}: no Rust type mapped for {other}", vector.file),
            }
        }
    }
}

#[test]
fn generated_init_types_refuse_unknown_keys() {
    assert!(serde_json::from_value::<InitDocument>(json!({ "theme": "dark" })).is_err());
    assert!(serde_json::from_value::<InitDocument>(json!({ "sync": { "on": true } })).is_err());
}

#[test]
fn generated_types_reject_a_request_without_scope() {
    let request = json!({ "id": 1, "method": "fs.read", "params": { "path": "~/a.txt" } });
    assert!(serde_json::from_value::<BridgeRequest>(request).is_err());
}
