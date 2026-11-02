//! Contract: specs/update/v0. Its vectors are judged by its schemas and read through the generated
//! types, and every decision case gives its expected answer through the policy, so the release
//! scripts and the desk agree on one written format and one set of rules.

mod support;

use std::fs;
use std::path::{Path, PathBuf};

use desk_update::generated::ReleaseChannel;
use desk_update::manifest::{self, Listed};
use desk_update::policy::{bucket, choose, listed};
use desk_update::verify::verify;
use semver::Version;
use serde_json::{Value, json};
use support::Key;

fn spec() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../specs/update/v0")
}

fn read_json(path: &Path) -> Value {
    let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// The JSON files of one folder of the spec, by name.
fn files(folder: &str) -> Vec<(String, Value)> {
    let dir = spec().join(folder);
    let mut paths: Vec<PathBuf> = fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    paths.sort();
    paths
        .iter()
        .map(|path| {
            let name = path.file_stem().unwrap().to_string_lossy().into_owned();
            (name, read_json(path))
        })
        .collect()
}

/// A validator for one definition of the update schemas, which reference each other.
fn validator(target: &str) -> jsonschema::Validator {
    let docs: Vec<Value> = ["index", "release"]
        .iter()
        .map(|name| read_json(&spec().join(format!("{name}.schema.json"))))
        .collect();
    let registry = jsonschema::Registry::new()
        .extend(
            docs.iter()
                .map(|doc| (doc["$id"].as_str().unwrap().to_owned(), doc.clone())),
        )
        .unwrap()
        .prepare()
        .unwrap();
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

/// Read a document as the desk does and write it back.
fn round_trip(target: &str, instance: &Value) -> Value {
    let bytes = serde_json::to_vec(instance).unwrap();
    match target {
        "ReleaseIndex" => serde_json::to_value(manifest::index(&bytes).unwrap()).unwrap(),
        "ReleaseManifest" => serde_json::to_value(manifest::release(&bytes).unwrap()).unwrap(),
        "ReleaseListing" => {
            serde_json::to_value(serde_json::from_slice::<Listed>(&bytes).unwrap()).unwrap()
        }
        other => panic!("no reader for {other}"),
    }
}

#[test]
fn index_and_release_vectors_are_judged_by_the_schemas() {
    for (kind, valid) in [("vectors/valid", true), ("vectors/invalid", false)] {
        let vectors = files(kind);
        assert!(vectors.len() >= 5, "{kind}: at least five vectors");
        for (name, vector) in vectors {
            let target = vector["target"].as_str().unwrap();
            let instance = &vector["instance"];
            let errors: Vec<String> = validator(target)
                .iter_errors(instance)
                .map(|e| format!("{e} at {}", e.instance_path()))
                .collect();
            if !valid {
                assert!(!errors.is_empty(), "{kind}/{name} passed {target}");
                continue;
            }
            assert!(errors.is_empty(), "{kind}/{name}: {errors:?}");
            let back = round_trip(target, instance);
            if name.contains("unknown-fields") {
                // Read past, not refused, and not carried on either.
                assert_eq!(back["releases"][0]["version"], instance["releases"][0]["version"]);
                assert!(back.get("mirror").is_none(), "{name} kept a field it does not know");
            } else {
                assert_eq!(&back, instance, "{kind}/{name} does not round-trip");
            }
        }
    }
}

#[test]
fn an_unknown_channel_does_not_read_as_an_index() {
    let (_, vector) = files("vectors/invalid")
        .into_iter()
        .find(|(name, _)| name == "index-unknown-channel")
        .unwrap();
    let bytes = serde_json::to_vec(&vector["instance"]).unwrap();
    assert!(manifest::index(&bytes).is_err());
}

#[test]
fn decision_vectors_pick_the_expected_build() {
    let decisions = files("decisions");
    assert!(decisions.len() >= 8, "one decision per rule");
    let index_schema = validator("ReleaseIndex");
    for (name, case) in decisions {
        assert!(
            index_schema.is_valid(&case["index"]),
            "{name}: its index does not pass ReleaseIndex"
        );
        let index = manifest::index(&serde_json::to_vec(&case["index"]).unwrap()).unwrap();
        let current = Version::parse(case["current"].as_str().unwrap()).unwrap();
        let targets: Vec<String> = serde_json::from_value(case["targets"].clone()).unwrap();
        let salt = hex(case["salt"].as_str().unwrap());
        let next = choose(&index, &current, &targets, |v| bucket(&salt, v)).map(|l| &l.version);
        let expected = case["expect"]["next"].as_str();
        assert_eq!(next.map(String::as_str), expected, "{name}: the next build");

        let Some(staged) = case["staged"].as_str() else {
            assert!(case["expect"].get("staged").is_none(), "{name}: no staged build");
            continue;
        };
        let fate = if !listed(&index, staged) {
            "dropped"
        } else if expected == Some(staged) {
            "kept"
        } else if expected.is_some() {
            "replaced"
        } else {
            "dropped"
        };
        assert_eq!(Some(fate), case["expect"]["staged"].as_str(), "{name}: the staged build");
    }
}

#[test]
fn the_rollout_bucket_matches_the_vectors() {
    for (name, case) in files("decisions") {
        let salt = hex(case["salt"].as_str().unwrap());
        let buckets = case["buckets"].as_object().unwrap();
        assert!(!buckets.is_empty() || case["index"]["releases"] == json!([]), "{name}");
        for (version, expected) in buckets {
            assert_eq!(
                u64::from(bucket(&salt, version)),
                expected.as_u64().unwrap(),
                "{name}: the bucket for {version}"
            );
        }
    }
}

#[test]
fn a_signed_index_from_a_vector_verifies_and_one_flipped_byte_does_not() {
    let key = Key::new();
    let (_, vector) = files("vectors/valid")
        .into_iter()
        .find(|(name, _)| name == "index-stable")
        .unwrap();
    let bytes = serde_json::to_vec_pretty(&vector["instance"]).unwrap();
    let signature = key.sign(&bytes, None);
    assert_eq!(verify(&bytes, &signature, &key.public(), None), Ok(()));
    let index = manifest::index(&bytes).unwrap();
    assert_eq!(index.channel, ReleaseChannel::Stable);
    assert_eq!(index.serial, 7);

    let mut flipped = bytes.clone();
    let at = flipped.len() / 2;
    flipped[at] ^= 0x01;
    assert!(verify(&flipped, &signature, &key.public(), None).is_err());
    assert!(verify(&bytes, &signature, &Key::new().public(), None).is_err());
}

fn hex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}
