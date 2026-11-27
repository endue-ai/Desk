//! Contract for dialog.* (#308): every `dialog-*` vector is judged by the bridge's JSON Schemas as its
//! folder says, and every valid one round-trips through the generated types unchanged.

use std::fs;
use std::path::{Path, PathBuf};

use desk_bridge::{BridgeRequest, DialogOpenKind, DialogOpenResult, DialogSaveResult};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

fn specs() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../specs")
}

fn read_json(path: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
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

/// `(file, valid, target, instance)` of every `dialog-*` vector.
fn dialog_vectors() -> Vec<(String, bool, String, Value)> {
    let mut out = Vec::new();
    for (kind, valid) in [("valid", true), ("invalid", false)] {
        let dir = specs().join("bridge/v0/vectors").join(kind);
        let mut paths: Vec<PathBuf> = fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("dialog-")
            })
            .collect();
        paths.sort();
        for path in paths {
            let mut doc = read_json(&path);
            let file = format!("{kind}/{}", path.file_name().unwrap().to_string_lossy());
            let target = doc["target"].as_str().unwrap().to_owned();
            out.push((file, valid, target, doc["instance"].take()));
        }
    }
    out
}

fn roundtrip<T: DeserializeOwned + Serialize>(file: &str, instance: &Value) {
    let typed: T = serde_json::from_value(instance.clone())
        .unwrap_or_else(|e| panic!("{file} does not deserialize: {e}"));
    assert_eq!(
        &serde_json::to_value(&typed).unwrap(),
        instance,
        "{file} changed"
    );
}

#[test]
fn dialog_vectors_roundtrip() {
    let mut docs = Vec::new();
    for folder in [
        "plugin/v0",
        "item/v0",
        "view/v0",
        "connector/v0",
        "memory/v0",
        "agent/v0",
    ] {
        docs.extend(schemas(folder));
    }
    docs.extend(schemas("market/v0"));
    docs.extend(schemas("bridge/v0"));
    let registry = jsonschema::Registry::new()
        .extend(
            docs.iter()
                .map(|doc| (doc["$id"].as_str().unwrap().to_owned(), doc.clone())),
        )
        .unwrap()
        .prepare()
        .unwrap();
    let id = "https://endue.ai/specs/bridge/v0";
    let vectors = dialog_vectors();
    assert_eq!(
        vectors.len(),
        13,
        "the contract names thirteen dialog vectors"
    );
    for (file, valid, target, instance) in &vectors {
        let schema = if target == "BridgeRequest" {
            "bridge"
        } else {
            "dialog"
        };
        let validator = jsonschema::options()
            .with_registry(&registry)
            .should_validate_formats(false)
            .build(&json!({ "$ref": format!("{id}/{schema}.schema.json#/$defs/{target}") }))
            .unwrap();
        assert_eq!(
            validator.is_valid(instance),
            *valid,
            "{file} judged wrongly"
        );
        if !valid {
            continue;
        }
        match target.as_str() {
            "BridgeRequest" => roundtrip::<BridgeRequest>(file, instance),
            "DialogOpenResult" => roundtrip::<DialogOpenResult>(file, instance),
            "DialogSaveResult" => roundtrip::<DialogSaveResult>(file, instance),
            other => panic!("{file}: no type for {other}"),
        }
    }
    let folders: BridgeRequest = serde_json::from_value(
        vectors
            .iter()
            .find(|v| v.0.ends_with("folders.json"))
            .unwrap()
            .3
            .clone(),
    )
    .unwrap();
    let BridgeRequest::DialogOpen(folders) = folders else {
        panic!("not dialog.open")
    };
    assert_eq!(folders.params.kind, Some(DialogOpenKind::Folders));
}
