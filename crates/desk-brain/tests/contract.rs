//! Contract: the brain vectors are judged by the component schemas of specs/brain/v0/openapi.yaml
//! (embedded in the generated code) exactly as their folders say, and valid vectors round-trip
//! through the generated Rust types.

use std::fs;
use std::path::{Path, PathBuf};

use desk_brain::{
    BRAIN_SCHEMA_JSON, BrainError, CreateSessionRequest, Lease, LeaseAcquireRequest, Session,
    ToolResultRequest, TurnEvent, TurnRequest,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

struct Vector {
    file: String,
    valid: bool,
    target: String,
    instance: Value,
}

fn vectors() -> Vec<Vector> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../specs/brain/v0/vectors");
    let mut out = Vec::new();
    for (kind, valid) in [("valid", true), ("invalid", false)] {
        let mut paths: Vec<PathBuf> = fs::read_dir(root.join(kind))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        paths.sort();
        for path in paths {
            let mut doc: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
            out.push(Vector {
                file: format!("{kind}/{}", path.file_name().unwrap().to_string_lossy()),
                valid,
                target: doc["target"].as_str().unwrap().to_owned(),
                instance: doc["instance"].take(),
            });
        }
    }
    out
}

#[test]
fn brain_vectors_are_judged_as_their_folder_says() {
    let schema: Value = serde_json::from_str(BRAIN_SCHEMA_JSON).unwrap();
    let id = schema["$id"].as_str().unwrap().to_owned();
    let registry = jsonschema::Registry::new()
        .add(&id, schema)
        .unwrap()
        .prepare()
        .unwrap();
    let mut wrong = Vec::new();
    for vector in vectors() {
        let validator = jsonschema::options()
            .with_registry(&registry)
            .should_validate_formats(false)
            .build(&json!({ "$ref": format!("{id}#/$defs/{}", vector.target) }))
            .unwrap();
        if validator.is_valid(&vector.instance) != vector.valid {
            wrong.push(vector.file);
        }
    }
    assert_eq!(wrong, Vec::<String>::new());
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
    for vector in vectors().iter().filter(|v| v.valid) {
        match vector.target.as_str() {
            "Session" => roundtrip::<Session>(vector),
            "CreateSessionRequest" => roundtrip::<CreateSessionRequest>(vector),
            "TurnRequest" => roundtrip::<TurnRequest>(vector),
            "TurnEvent" => roundtrip::<TurnEvent>(vector),
            "ToolResultRequest" => roundtrip::<ToolResultRequest>(vector),
            "Lease" => roundtrip::<Lease>(vector),
            "LeaseAcquireRequest" => roundtrip::<LeaseAcquireRequest>(vector),
            "BrainError" => roundtrip::<BrainError>(vector),
            other => panic!("{}: no Rust type mapped for {other}", vector.file),
        }
    }
}

#[test]
fn generated_types_reject_an_unknown_turn_event() {
    let event = json!({ "type": "turn.paused", "turnId": "t1" });
    assert!(serde_json::from_value::<TurnEvent>(event).is_err());
}
