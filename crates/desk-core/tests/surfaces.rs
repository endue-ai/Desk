//! ui.surface.open and ui.surface.close through `Core::handle`: a surface opens only under
//! `ui:surface` and only when the caller's manifest declares it, the runtime hears
//! `ui.surface.opened` and `ui.surface.closed`, a handle belongs to the caller that opened it, and a
//! plugin turned off closes its surfaces.

mod support;

use std::fs;
use std::path::Path;
use std::sync::mpsc::Receiver;

use desk_bridge::{BridgeError, ErrorCode, PluginStatus};
use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::{Seen, call, drain, grant, home, plugin_manage, roots, set_enabled};

const HELLO: &str = "example.hello";
const OTHER: &str = "example.other";

fn surface() -> Value {
    json!({ "permission": "ui:surface" })
}

/// Install the UI plugin `id`, which declares `main` (center, titled "Hello") and `panel` (right,
/// untitled).
fn install_ui(core: &Core, home: &Path, id: &str) {
    let dir = home.join("plugins").join(id);
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>hello</p>").unwrap();
    let manifest = json!({
        "id": id, "version": "0.1.0", "kind": "ui", "entry": "ui/index.html",
        "surfaces": [
            { "id": "main", "placement": "center", "title": "Hello" },
            { "id": "panel", "placement": "right" },
        ],
    });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    let info = core.install_plugin(&dir, false);
    assert_eq!(info.status, PluginStatus::Ready, "{:?}", info.error);
}

/// A core with `example.hello` and `example.other` installed.
fn core() -> Core {
    let home = home("surfaces");
    let core = Core::new(roots(&home));
    install_ui(&core, &home, HELLO);
    install_ui(&core, &home, OTHER);
    core
}

fn open(core: &Core, caller: &str, params: Value) -> Result<Value, BridgeError> {
    call(core, caller, "ui.surface.open", params)
}

fn open_main(core: &Core, caller: &str) -> Result<Value, BridgeError> {
    open(
        core,
        caller,
        json!({ "surface": "main", "scope": surface() }),
    )
}

fn handle_of(opened: Value) -> String {
    opened["handle"].as_str().unwrap().to_owned()
}

fn close(core: &Core, caller: &str, handle: &str) -> Result<Value, BridgeError> {
    let params = json!({ "handle": handle, "scope": surface() });
    call(core, caller, "ui.surface.close", params)
}

/// The `ui.surface.*` deliveries so far, without waiting.
fn surface_events(deliveries: &Receiver<Delivery>) -> Vec<Seen> {
    drain(deliveries)
        .into_iter()
        .filter(|seen| seen.name().starts_with("ui.surface."))
        .collect()
}

fn for_the_runtime(seen: &[Seen]) -> bool {
    seen.iter().all(|s| s.to == Some(vec!["desk".to_owned()]))
}

#[test]
fn ui_surface_open_needs_ui_surface_and_a_surface_the_manifest_declares() {
    let core = core();
    let deliveries = core.events().subscribe_addressed();
    let refused = open_main(&core, HELLO).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied, "{refused:?}");
    assert_eq!(
        serde_json::to_value(refused.permission.unwrap()).unwrap(),
        surface(),
        "the missing permission is named"
    );

    grant(&core, HELLO, surface());
    grant(&core, "desk", surface());
    let side = open(
        &core,
        HELLO,
        json!({ "surface": "side", "scope": surface() }),
    )
    .unwrap_err();
    assert_eq!(side.code, ErrorCode::InvalidParams, "an undeclared surface");
    let desk = open_main(&core, "desk").unwrap_err();
    assert_eq!(desk.code, ErrorCode::InvalidParams, "desk has no manifest");
    assert!(surface_events(&deliveries).is_empty(), "nothing opened");
    assert_eq!(core.surface_count(), 0);

    assert_eq!(open_main(&core, HELLO).unwrap(), json!({ "handle": "s-1" }));
    let seen = surface_events(&deliveries);
    assert!(for_the_runtime(&seen), "{seen:?}");
    assert_eq!(
        seen.iter().map(|s| s.event.clone()).collect::<Vec<_>>(),
        vec![json!({ "event": "ui.surface.opened",
                     "data": { "handle": "s-1", "caller": HELLO, "surface": "main",
                               "placement": "center", "title": "Hello" } })]
    );

    let again = open(
        &core,
        HELLO,
        json!({ "surface": "main", "placement": "right", "title": "Hi", "scope": surface() }),
    )
    .unwrap();
    assert_eq!(
        again,
        json!({ "handle": "s-2" }),
        "an open surface opens again"
    );
    let seen = surface_events(&deliveries);
    assert_eq!(seen.len(), 1, "{seen:?}");
    assert_eq!(
        seen[0].data(),
        &json!({ "handle": "s-2", "caller": HELLO, "surface": "main", "placement": "right",
                 "title": "Hi" })
    );

    // A surface the manifest leaves untitled has no title unless the call gives one.
    let panel = open(
        &core,
        HELLO,
        json!({ "surface": "panel", "scope": surface() }),
    )
    .unwrap();
    assert_eq!(handle_of(panel), "s-3");
    let seen = surface_events(&deliveries);
    assert_eq!(
        seen[0].data(),
        &json!({ "handle": "s-3", "caller": HELLO, "surface": "panel", "placement": "right" })
    );
    assert_eq!(core.surface_count(), 3);
}

#[test]
fn ui_surface_close_needs_a_handle_the_caller_holds() {
    let core = core();
    grant(&core, HELLO, surface());
    grant(&core, OTHER, surface());
    let handle = handle_of(open_main(&core, HELLO).unwrap());
    let deliveries = core.events().subscribe_addressed();

    let stranger = close(&core, OTHER, &handle).unwrap_err();
    assert_eq!(
        stranger.code,
        ErrorCode::NotFound,
        "another caller's handle"
    );
    let unknown = close(&core, HELLO, "s-99").unwrap_err();
    assert_eq!(unknown.code, ErrorCode::NotFound, "an unknown handle");
    let ungranted = close(&core, "example.stranger", &handle).unwrap_err();
    assert_eq!(ungranted.code, ErrorCode::PermissionDenied, "no ui:surface");
    assert!(surface_events(&deliveries).is_empty());
    assert_eq!(core.surface_count(), 1);

    assert_eq!(close(&core, HELLO, &handle).unwrap(), json!({}));
    let seen = surface_events(&deliveries);
    assert!(for_the_runtime(&seen), "{seen:?}");
    assert_eq!(
        seen.iter().map(|s| s.event.clone()).collect::<Vec<_>>(),
        vec![json!({ "event": "ui.surface.closed",
                     "data": { "handle": handle, "caller": HELLO, "surface": "main" } })]
    );
    let again = close(&core, HELLO, &handle).unwrap_err();
    assert_eq!(again.code, ErrorCode::NotFound, "a closed handle");
    assert_eq!(core.surface_count(), 0);
}

#[test]
fn a_disabled_plugin_closes_its_surfaces() {
    let core = core();
    grant(&core, HELLO, surface());
    let other_grant = grant(&core, OTHER, surface());
    grant(&core, "desk", plugin_manage());
    let main = handle_of(open_main(&core, HELLO).unwrap());
    let panel = open(
        &core,
        HELLO,
        json!({ "surface": "panel", "scope": surface() }),
    )
    .unwrap();
    let panel = handle_of(panel);
    let others = handle_of(open_main(&core, OTHER).unwrap());

    // Losing ui:surface leaves a caller's surfaces open: they are the person's windows.
    call(
        &core,
        OTHER,
        "perm.revoke",
        json!({ "grantId": other_grant }),
    )
    .unwrap();
    assert_eq!(core.surface_count(), 3, "a revoke closes nothing");

    let deliveries = core.events().subscribe_addressed();
    set_enabled(&core, HELLO, false);
    let seen = surface_events(&deliveries);
    assert!(for_the_runtime(&seen), "{seen:?}");
    let closed: Vec<Value> = seen
        .iter()
        .filter(|s| s.name() == "ui.surface.closed")
        .map(|s| s.data().clone())
        .collect();
    assert_eq!(
        closed,
        vec![
            json!({ "handle": main, "caller": HELLO, "surface": "main" }),
            json!({ "handle": panel, "caller": HELLO, "surface": "panel" }),
        ]
    );
    assert_eq!(core.surface_count(), 1, "{others} stays open");

    let off = open_main(&core, HELLO).unwrap_err();
    assert_eq!(
        off.code,
        ErrorCode::InvalidParams,
        "a plugin turned off opens nothing"
    );
    assert_eq!(core.surface_count(), 1);
}
