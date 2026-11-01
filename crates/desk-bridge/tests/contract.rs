//! Contract: the bridge, plugin, item, view, connector and init vectors are judged by the JSON Schemas
//! (and, for views and manifests, the rules the schemas cannot say) exactly as their folders say, and
//! every valid vector round-trips through the generated Rust types unchanged.

use std::fs;
use std::path::{Path, PathBuf};

use desk_bridge::{
    BridgeEvent, BridgeRequest, BridgeResponse, CatalogGetResult, ConnectorInstance,
    ConnectorManifest, ConnectorStatus, ConnectorSyncResult, FsReadResult, FsUrlResult,
    InitDocument, InitGetResult, InitSettingKey, Item, ItemChange, ItemPage, ItemQuery,
    PaletteResults, PermQueryResult, Permission, PluginContributes, PluginListResult,
    PluginManifest, ShellOpenResult, StoreGetResult, View, ViewGetResult, ViewListResult,
    ViewSource, ViewSummary, manifest_problems, view_problems,
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

/// One registry of `docs`, and a validator for each of their definitions, by name.
fn validators(docs: &[Value]) -> impl Fn(&str) -> jsonschema::Validator + '_ {
    let registry = jsonschema::Registry::new()
        .extend(
            docs.iter()
                .map(|doc| (doc["$id"].as_str().unwrap().to_owned(), doc.clone())),
        )
        .unwrap()
        .prepare()
        .unwrap();
    move |target: &str| {
        let uri = docs
            .iter()
            .find(|doc| doc["$defs"].get(target).is_some())
            .map(|doc| format!("{}#/$defs/{target}", doc["$id"].as_str().unwrap()))
            .unwrap_or_else(|| panic!("no definition named {target}"));
        jsonschema::options()
            .with_registry(&registry)
            .should_validate_formats(false)
            .build(&json!({ "$ref": uri }))
            .unwrap()
    }
}

/// Validate every vector of `spec` against `docs`; returns the files judged differently.
fn judge(docs: &[Value], spec: &str) -> Vec<String> {
    let validator = validators(docs);
    let mut wrong = Vec::new();
    for vector in vectors(spec) {
        let valid = validator(&vector.target).is_valid(&vector.instance)
            && names_resolve(&vector.target, &vector.instance);
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
                "FsReadResult" => roundtrip::<FsReadResult>(vector),
                "FsUrlResult" => roundtrip::<FsUrlResult>(vector),
                "PermQueryResult" => roundtrip::<PermQueryResult>(vector),
                "PluginListResult" => roundtrip::<PluginListResult>(vector),
                "StoreGetResult" => roundtrip::<StoreGetResult>(vector),
                "CatalogGetResult" => roundtrip::<CatalogGetResult>(vector),
                "ShellOpenResult" => roundtrip::<ShellOpenResult>(vector),
                "PluginManifest" => roundtrip::<PluginManifest>(vector),
                "Permission" => roundtrip::<Permission>(vector),
                "InitDocument" => roundtrip::<InitDocument>(vector),
                "InitSettingKey" => roundtrip::<InitSettingKey>(vector),
                "InitGetResult" => roundtrip::<InitGetResult>(vector),
                "PluginContributes" => roundtrip::<PluginContributes>(vector),
                "PaletteResults" => roundtrip::<PaletteResults>(vector),
                "ViewListResult" => roundtrip::<ViewListResult>(vector),
                "ViewGetResult" => roundtrip::<ViewGetResult>(vector),
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
    let query = json!({ "id": 2, "method": "data.query", "params": { "query": {} } });
    assert!(serde_json::from_value::<BridgeRequest>(query).is_err());
}

#[test]
fn typed_view_results_say_where_each_view_came_from() {
    let mut docs = plugin_schemas();
    docs.extend(schemas("bridge/v0"));
    let validator = validators(&docs);
    let summary = |id: &str, source, plugin: Option<&str>| ViewSummary {
        id: id.to_owned(),
        version: "0.1.0".to_owned(),
        title: "Today".to_owned(),
        description: None,
        source,
        plugin: plugin.map(str::to_owned),
    };
    let listed = ViewListResult {
        views: vec![
            summary("desk.today", ViewSource::Plugin, Some("desk.today")),
            summary("example.notes", ViewSource::File, None),
        ],
    };
    let listed = serde_json::to_value(&listed).unwrap();
    assert!(validator("ViewListResult").is_valid(&listed), "{listed}");
    assert_eq!(listed["views"][0]["source"], "plugin");
    assert_eq!(listed["views"][1]["source"], "file");
    assert_eq!(listed["views"][1].get("plugin"), None);

    let vector = specs().join("bridge/v0/vectors/valid/view-get-result-plugin.json");
    let view = read_json(&vector)["instance"]["view"].take();
    let unnamed = json!({ "view": view, "source": "plugin" });
    assert!(!validator("ViewGetResult").is_valid(&unnamed), "{unnamed}");
}
