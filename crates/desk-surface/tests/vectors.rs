//! Contract: specs/surface/v0. Every vector is judged by the schemas as its folder says, every valid
//! one reads through the generated types and writes back the same JSON, and the invalid ones that
//! are a matter of shape are refused by the types too. packages/bridge/src/surface.contract.test.ts
//! holds the TypeScript side to the same vectors, so the compositor, desk-web and a native plugin
//! agree on one wire format.

use std::fs;
use std::path::{Path, PathBuf};

use desk_surface::generated::{
    CompositorMessage, SurfaceA11yNode, SurfaceAttach, SurfaceAttachType, SurfaceCursor,
    SurfaceDmaBufHandle, SurfaceDmaBufHandleKind, SurfaceDmaBufPlane, SurfaceDragItem,
    SurfaceFormat, SurfaceMessage, SurfacePixelRect, SurfaceReleaseWhen, SurfaceTexture,
    SurfaceTextureHandle,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

fn spec() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../specs/surface/v0")
}

fn read_json(path: &Path) -> Value {
    let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// The JSON files of one folder of the spec whose names end with `suffix`, sorted, by file name.
fn files(folder: &str, suffix: &str) -> Vec<(String, Value)> {
    let dir = spec().join(folder);
    let mut paths: Vec<PathBuf> = fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.to_string_lossy().ends_with(suffix))
        .collect();
    paths.sort();
    paths
        .iter()
        .map(|path| {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            (name, read_json(path))
        })
        .collect()
}

fn schemas() -> Vec<Value> {
    files("", ".schema.json")
        .into_iter()
        .map(|(_, doc)| doc)
        .collect()
}

/// One registry of the surface schemas, which reference each other, and a validator per definition.
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

/// Every number as an f64, so `10` and `10.0` compare equal: logical coordinates are f64 in Rust.
fn numbers_as_f64(value: Value) -> Value {
    match value {
        Value::Number(n) => json!(n.as_f64().unwrap()),
        Value::Array(items) => Value::Array(items.into_iter().map(numbers_as_f64).collect()),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| (key, numbers_as_f64(value)))
                .collect(),
        ),
        other => other,
    }
}

fn read_as<T: DeserializeOwned + Serialize>(instance: &Value) -> Result<Value, String> {
    let typed: T = serde_json::from_value(instance.clone()).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&typed).unwrap())
}

/// Read a vector's instance through the generated type its target names, and write it back.
fn round_trip(target: &str, instance: &Value) -> Result<Value, String> {
    match target {
        "CompositorMessage" => read_as::<CompositorMessage>(instance),
        "SurfaceMessage" => read_as::<SurfaceMessage>(instance),
        "SurfaceTextureHandle" => read_as::<SurfaceTextureHandle>(instance),
        "SurfaceCursor" => read_as::<SurfaceCursor>(instance),
        "SurfaceDragItem" => read_as::<SurfaceDragItem>(instance),
        "SurfaceA11yNode" => read_as::<SurfaceA11yNode>(instance),
        other => panic!("no reader for {other}: add one here"),
    }
}

/// Invalid vectors whose fault is one of shape (a message sent the wrong way, an unknown type or
/// field, a missing field, a value of the wrong JSON type): the types refuse them as the schemas do.
/// Ranges, patterns and lengths are the schemas' alone.
const REFUSED_BY_THE_TYPES: &[&str] = &[
    "attach-sent-by-the-compositor.json",
    "create-sent-by-a-surface.json",
    "create-unknown-field.json",
    "dmabuf-modifier-as-number.json",
    "key-down-without-code.json",
    "a11y-node-unknown-field.json",
    "message-unknown-type.json",
];

#[test]
fn vectors_are_judged_by_the_schemas_and_valid_ones_round_trip() {
    let docs = schemas();
    let validator = validators(&docs);
    for (kind, valid) in [("vectors/valid", true), ("vectors/invalid", false)] {
        let vectors = files(kind, ".json");
        assert!(vectors.len() >= 5, "{kind}: at least five vectors");
        for (name, vector) in vectors {
            assert!(
                vector["description"].is_string(),
                "{kind}/{name}: description"
            );
            let target = vector["target"].as_str().unwrap();
            let instance = &vector["instance"];
            let errors: Vec<String> = validator(target)
                .iter_errors(instance)
                .map(|e| format!("{e} at {}", e.instance_path()))
                .collect();
            if !valid {
                assert!(!errors.is_empty(), "{kind}/{name} passed {target}");
                if REFUSED_BY_THE_TYPES.contains(&name.as_str()) {
                    assert!(
                        round_trip(target, instance).is_err(),
                        "{kind}/{name}: the generated types read it"
                    );
                }
                continue;
            }
            assert!(errors.is_empty(), "{kind}/{name}: {errors:?}");
            let back = round_trip(target, instance)
                .unwrap_or_else(|e| panic!("{kind}/{name} does not read: {e}"));
            assert_eq!(
                numbers_as_f64(back),
                numbers_as_f64(instance.clone()),
                "{kind}/{name} changed in a round trip"
            );
        }
    }
}

#[test]
fn every_refused_vector_named_here_exists() {
    let invalid: Vec<String> = files("vectors/invalid", ".json")
        .into_iter()
        .map(|(name, _)| name)
        .collect();
    for name in REFUSED_BY_THE_TYPES {
        assert!(
            invalid.iter().any(|n| n == name),
            "no invalid vector {name}"
        );
    }
}

#[test]
fn a_message_of_one_direction_does_not_read_as_the_other() {
    for (name, vector) in files("vectors/valid", ".json") {
        let instance = &vector["instance"];
        match vector["target"].as_str().unwrap() {
            "CompositorMessage" => assert!(
                serde_json::from_value::<SurfaceMessage>(instance.clone()).is_err(),
                "{name} reads as a surface's message"
            ),
            "SurfaceMessage" => assert!(
                serde_json::from_value::<CompositorMessage>(instance.clone()).is_err(),
                "{name} reads as the compositor's message"
            ),
            _ => {}
        }
    }
}

#[test]
fn a_typed_attach_writes_what_the_schema_accepts() {
    let attach = SurfaceAttach {
        r#type: SurfaceAttachType::Attach,
        surface: "s-7".to_owned(),
        frame: 41,
        texture: SurfaceTexture {
            id: 1,
            generation: 3,
            width: 1600,
            height: 1200,
            format: SurfaceFormat::Bgra8,
            handle: SurfaceTextureHandle::SurfaceDmaBuf(SurfaceDmaBufHandle {
                kind: SurfaceDmaBufHandleKind::Dmabuf,
                fourcc: "AR24".to_owned(),
                modifier: "0x0".to_owned(),
                planes: vec![SurfaceDmaBufPlane {
                    fd_index: 0,
                    stride: 6400,
                    offset: 0,
                }],
            }),
        },
        damage: vec![SurfacePixelRect {
            x: 0,
            y: 0,
            width: 1600,
            height: 1200,
        }],
        release: SurfaceReleaseWhen::AfterCopy,
        fence_fd_index: None,
    };
    let written = serde_json::to_value(SurfaceMessage::SurfaceAttach(attach)).unwrap();
    assert_eq!(written["texture"]["handle"]["planes"][0]["fdIndex"], 0);
    let docs = schemas();
    let errors: Vec<String> = validators(&docs)("SurfaceMessage")
        .iter_errors(&written)
        .map(|e| e.to_string())
        .collect();
    assert!(errors.is_empty(), "{errors:?}");
}
