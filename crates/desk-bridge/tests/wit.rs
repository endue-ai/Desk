//! Contract: specs/wit/desk-host.wit parses, and every function in it is a bridge method.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

fn specs() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../specs")
}

/// Method names declared by `*Request` definitions in specs/bridge/v0.
fn bridge_methods() -> BTreeSet<String> {
    let mut methods = BTreeSet::new();
    for entry in fs::read_dir(specs().join("bridge/v0")).unwrap() {
        let path = entry.unwrap().path();
        if !path.to_string_lossy().ends_with(".schema.json") {
            continue;
        }
        let doc: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        for def in doc["$defs"].as_object().unwrap().values() {
            if let Some(method) = def["properties"]["method"]["const"].as_str() {
                methods.insert(method.to_owned());
            }
        }
    }
    methods
}

fn wit_functions() -> BTreeSet<String> {
    let mut resolve = wit_parser::Resolve::default();
    resolve
        .push_file(specs().join("wit/desk-host.wit"))
        .expect("desk-host.wit parses");
    let mut functions = BTreeSet::new();
    for (_, interface) in resolve.interfaces.iter() {
        let name = interface.name.clone().unwrap_or_default();
        for function in interface.functions.keys() {
            functions.insert(format!("{name}.{function}"));
        }
    }
    functions
}

#[test]
fn every_wit_function_is_a_bridge_method() {
    let methods = bridge_methods();
    let functions = wit_functions();
    assert!(!functions.is_empty(), "desk-host.wit declares no functions");
    let missing: Vec<&String> = functions.difference(&methods).collect();
    assert!(missing.is_empty(), "not bridge methods: {missing:?}");
}

#[test]
fn logic_plugins_cannot_spawn_processes_or_capture_audio() {
    let functions = wit_functions();
    let forbidden: Vec<&String> = functions
        .iter()
        .filter(|f| f.starts_with("proc.") || f.starts_with("audio.") || f.as_str() == "fs.watch")
        .collect();
    assert!(forbidden.is_empty(), "not allowed in v0: {forbidden:?}");
}
