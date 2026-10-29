//! specs/wit/desk-host.wit covers the bridge methods the host backs, and the three exports the host
//! calls: start, on-command and on-event.

use std::collections::BTreeSet;
use std::path::Path;

/// Every interface function, as the bridge method it is.
const FUNCTIONS: [&str; 21] = [
    "fs.read",
    "fs.list",
    "fs.write",
    "net.fetch",
    "ui.notify",
    "perm.query",
    "perm.request",
    "store.get",
    "store.set",
    "cmd.register",
    "cmd.unregister",
    "cmd.list",
    "cmd.invoke",
    "cmd.answer",
    "events.subscribe",
    "events.unsubscribe",
    "settings.get",
    "settings.set",
    "settings.list",
    "log.write",
    "log.tail",
];

fn resolve() -> (wit_parser::Resolve, wit_parser::PackageId) {
    let mut resolve = wit_parser::Resolve::default();
    let wit = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../specs/wit/desk-host.wit");
    let package = resolve.push_file(wit).expect("desk-host.wit parses");
    (resolve, package)
}

#[test]
fn the_world_covers_commands_events_settings_and_log_and_exports_three_functions() {
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
    let expected: BTreeSet<String> = FUNCTIONS.iter().map(|f| f.to_string()).collect();
    assert_eq!(functions, expected);

    let world = resolve
        .select_world(&[package], Some("plugin"))
        .expect("the plugin world exists");
    let exports: Vec<String> = resolve.worlds[world]
        .exports
        .keys()
        .map(|key| resolve.name_world_key(key))
        .collect();
    assert_eq!(exports, ["start", "on-command", "on-event"]);
}
