//! Contract: the platform subset's vectors (specs/platform/v0) are judged by its component schemas as
//! their folders say, every valid answer reads into the client's types, and the bodies the client
//! sends are ones the contract accepts.

use std::fs;
use std::path::{Path, PathBuf};

use desk_platform::wire::{
    AgentPage, AgentPatch, ConnectorBinding, Identity, Nature, NatureRole, NewAgent, Personality,
    Profile, PromptRevision, Settings, SettingsPatch, SkillBinding,
};
use desk_platform::wire_catalog::{CatalogAgent, ConversationPage, Recommended, Used};
use desk_platform::wire_spaces::{Room, Space, SpaceOverview};
use desk_platform::{ErrorKind, PlatformError};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

const ID: &str = "https://endue.ai/specs/platform/v0/platform.schema.json";

fn spec() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../specs/platform/v0")
}

/// The OpenAPI document's component schemas as one JSON Schema document, as spec-lint builds it.
fn bundle() -> Value {
    let text = fs::read_to_string(spec().join("openapi.yaml")).unwrap();
    let openapi: Value = yaml_serde::from_str(&text).unwrap();
    let defs = openapi["components"]["schemas"].to_string();
    let defs: Value =
        serde_json::from_str(&defs.replace("#/components/schemas/", "#/$defs/")).unwrap();
    json!({ "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": ID, "$defs": defs })
}

struct Vector {
    file: String,
    valid: bool,
    target: String,
    instance: Value,
}

fn vectors() -> Vec<Vector> {
    let mut out = Vec::new();
    for (kind, valid) in [("valid", true), ("invalid", false)] {
        let dir = spec().join("vectors").join(kind);
        let mut files: Vec<PathBuf> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .collect();
        files.sort();
        for file in files {
            let vector: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
            out.push(Vector {
                file: format!("{kind}/{}", file.file_name().unwrap().to_string_lossy()),
                valid,
                target: vector["target"].as_str().unwrap().to_owned(),
                instance: vector["instance"].clone(),
            });
        }
    }
    out
}

fn validator(target: &str) -> jsonschema::Validator {
    let registry = jsonschema::Registry::new()
        .add(ID, bundle())
        .unwrap()
        .prepare()
        .unwrap();
    jsonschema::options()
        .with_registry(&registry)
        .should_validate_formats(false)
        .build(&json!({ "$ref": format!("{ID}#/$defs/{target}") }))
        .unwrap()
}

#[test]
fn platform_vectors_are_judged_as_their_folder_says() {
    let all = vectors();
    assert!(all.iter().filter(|v| v.valid).count() >= 5);
    assert!(all.iter().filter(|v| !v.valid).count() >= 5);
    let wrong: Vec<&str> = all
        .iter()
        .filter(|v| validator(&v.target).is_valid(&v.instance) != v.valid)
        .map(|v| v.file.as_str())
        .collect();
    assert_eq!(wrong, Vec::<&str>::new());
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Envelope<T> {
    data: T,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct PromptAnswer {
    prompt: Option<PromptRevision>,
}

fn reads<T: DeserializeOwned>(vector: &Vector) {
    if let Err(e) = serde_json::from_value::<T>(vector.instance.clone()) {
        panic!("{} does not read into the client's type: {e}", vector.file);
    }
}

#[test]
fn valid_answers_read_into_the_client_types() {
    for vector in vectors().iter().filter(|v| v.valid) {
        match vector.target.as_str() {
            "AgentGetListResponse" => reads::<AgentPage>(vector),
            "IdentityResponse" => reads::<Identity>(vector),
            "AgentSettingsEnvelope" => reads::<Envelope<Settings>>(vector),
            "AgentPromptResponse" => reads::<PromptAnswer>(vector),
            "PromptRevision" => reads::<PromptRevision>(vector),
            "AgentSkillBinding" => reads::<SkillBinding>(vector),
            "AgentConnectorBinding" => reads::<ConnectorBinding>(vector),
            "CatalogListEnvelope" => reads::<Envelope<Vec<CatalogAgent>>>(vector),
            "RecommendEnvelope" => reads::<Envelope<Recommended>>(vector),
            "UseCatalogEnvelope" => reads::<Envelope<Used>>(vector),
            "ConversationListEnvelope" => reads::<Envelope<ConversationPage>>(vector),
            "SpaceListResponse" => reads::<Vec<Space>>(vector),
            "SpaceOverviewEnvelope" => reads::<Envelope<SpaceOverview>>(vector),
            "SpaceRoomListEnvelope" => reads::<Envelope<Vec<Room>>>(vector),
            "ErrorEnvelope" => {
                let bytes = serde_json::to_vec(&vector.instance).unwrap();
                let error = PlatformError::from_response(404, &bytes);
                assert_eq!(error.kind, ErrorKind::NotFound);
                assert_eq!(
                    error.code.as_deref(),
                    vector.instance["error"]["code"].as_str()
                );
            }
            // Requests: the client's own bodies are checked below.
            "CreateAgentRequest" | "UpdateAgentRequest" => {}
            other => panic!("{}: no client type mapped for {other}", vector.file),
        }
    }
}

#[test]
fn the_bodies_the_client_sends_are_the_contracts() {
    let created = NewAgent {
        nature: Nature {
            role: Some(NatureRole::of("Keeps my calendar")),
            personality: Some(Personality::default()),
            languages: Some(vec!["en".to_owned()]),
        },
        profile: Profile {
            name: Some("Miso".to_owned()),
            ..Profile::default()
        },
    };
    let patch = AgentPatch {
        nature: None,
        profile: Some(Profile {
            description: Some("Mail".to_owned()),
            ..Profile::default()
        }),
    };
    let settings = SettingsPatch {
        visibility: Some("unlisted".to_owned()),
        model: Some(None),
    };
    let bodies = [
        (
            "CreateAgentRequest",
            serde_json::to_value(&created).unwrap(),
        ),
        ("UpdateAgentRequest", serde_json::to_value(&patch).unwrap()),
        ("AgentSettingsUpdateRequest", settings.body()),
    ];
    for (target, body) in bodies {
        assert!(validator(target).is_valid(&body), "{target}: {body}");
    }
}
