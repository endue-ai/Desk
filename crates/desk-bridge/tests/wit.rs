//! Contract: the specs/wit folder parses as one, every interface function in it is a bridge method,
//! and the connector world imports only what a connector may reach.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use wit_parser::{PackageId, Resolve, WorldItem};

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

/// The whole specs/wit folder, `desk:host` with the nested `desk:connector`, and its main package.
fn resolve() -> (Resolve, PackageId) {
    let mut resolve = Resolve::default();
    let (package, _) = resolve
        .push_dir(specs().join("wit"))
        .expect("specs/wit parses as one folder");
    (resolve, package)
}

fn wit_functions() -> BTreeSet<String> {
    let (resolve, _) = resolve();
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
    assert!(!functions.is_empty(), "specs/wit declares no functions");
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

#[test]
fn the_connector_world_imports_five_host_interfaces_and_exports_four_functions() {
    let (resolve, package) = resolve();
    let world = resolve
        .select_world(&[package], Some("desk:connector/connector"))
        .expect("the connector world exists");
    let world = &resolve.worlds[world];

    let imports: BTreeSet<String> = world
        .imports
        .values()
        .filter_map(|item| match item {
            WorldItem::Interface { id, .. } => resolve.id_of(*id),
            _ => None,
        })
        .collect();
    let expected: BTreeSet<String> = [
        "desk:host/types",
        "desk:host/fs",
        "desk:host/net",
        "desk:host/perm",
        "desk:host/store",
        "desk:host/log",
        "desk:connector/types",
    ]
    .iter()
    .map(|name| format!("{name}@0.0.0"))
    .collect();
    assert_eq!(imports, expected);

    let exports: Vec<String> = world
        .exports
        .keys()
        .map(|key| resolve.name_world_key(key))
        .collect();
    assert_eq!(exports, ["sync", "query", "act", "status"]);
}
