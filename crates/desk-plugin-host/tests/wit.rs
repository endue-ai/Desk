//! specs/wit/desk-host.wit covers what the host backs: fs.write and the store, and the start export.

use std::collections::BTreeSet;
use std::path::Path;

fn resolve() -> (wit_parser::Resolve, wit_parser::PackageId) {
    let mut resolve = wit_parser::Resolve::default();
    let wit = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../specs/wit/desk-host.wit");
    let package = resolve.push_file(wit).expect("desk-host.wit parses");
    (resolve, package)
}

#[test]
fn the_world_covers_fs_write_and_the_store() {
    let (resolve, package) = resolve();
    let functions: BTreeSet<String> = resolve
        .interfaces
        .iter()
        .flat_map(|(_, interface)| {
            let name = interface.name.clone().unwrap_or_default();
            interface
                .functions
                .keys()
                .map(move |f| format!("{name}.{f}"))
        })
        .collect();
    for method in ["fs.read", "fs.list", "fs.write", "store.get", "store.set"] {
        assert!(functions.contains(method), "desk-host.wit lacks {method}");
    }

    let world = resolve
        .select_world(&[package], Some("plugin"))
        .expect("the plugin world exists");
    let exports: Vec<String> = resolve.worlds[world]
        .exports
        .keys()
        .map(|key| resolve.name_world_key(key))
        .collect();
    assert_eq!(exports, ["start"]);
}
