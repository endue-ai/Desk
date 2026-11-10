//! ui.surface.snapshot through `Core::handle` (#54, ADR 0161): a PNG of a surface's last frame from
//! the compositor the shell hands the core. It needs `ui:surface`; a plugin snapshots only its own
//! surfaces, a caller without a manifest (the runtime, an agent, the CLI) any surface; a surface
//! with no frame is `not_found`, a desk without a compositor `unsupported`.

mod support;

use std::sync::{Arc, Mutex};

use base64::Engine;
use desk_bridge::ErrorCode;
use desk_core::{Core, ShotError, SurfaceShot, SurfaceSnapshots};
use serde_json::{Value, json};
use support::{call, grant, home, roots};

const HELLO: &str = "example.hello";
const OTHER: &str = "example.other";

/// The 2 by 1 PNG of the bridge's vectors.
const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQZGBgAQd8E/G4fLSoAAAAASUVORK5CYII=";

/// A compositor holding one frame, `example.hello`'s main surface, which sleeps; it records what
/// it was asked.
#[derive(Default)]
struct Held {
    asked: Mutex<Vec<(String, String, (Option<u32>, Option<u32>))>>,
}

impl SurfaceSnapshots for Held {
    fn snapshot(
        &self,
        plugin: &str,
        surface: &str,
        max: (Option<u32>, Option<u32>),
    ) -> Result<SurfaceShot, ShotError> {
        let asked = (plugin.to_owned(), surface.to_owned(), max);
        self.asked.lock().unwrap().push(asked);
        if (plugin, surface) != (HELLO, "main") {
            return Err(ShotError::NotFound(format!("{plugin} shows no {surface}")));
        }
        let png = base64::engine::general_purpose::STANDARD
            .decode(PNG)
            .unwrap();
        Ok(SurfaceShot {
            png,
            width: 2,
            height: 1,
            scale: 2.0,
            asleep: true,
        })
    }
}

fn scope() -> Value {
    json!({ "permission": "ui:surface" })
}

fn snapshot(core: &Core, caller: &str, params: Value) -> Result<Value, desk_bridge::BridgeError> {
    call(core, caller, "ui.surface.snapshot", params)
}

fn core_with(held: &Arc<Held>) -> Core {
    let core = Core::new(roots(&home("ui-snapshot")));
    core.set_surface_snapshots(Some(held.clone()));
    core
}

#[test]
fn a_snapshot_is_the_compositors_png_with_its_size_scale_and_sleep() {
    let held = Arc::new(Held::default());
    let core = core_with(&held);
    grant(&core, HELLO, scope());
    let params = json!({ "plugin": HELLO, "maxWidth": 640, "scope": scope() });
    let shot = snapshot(&core, HELLO, params).unwrap();
    assert_eq!(
        shot,
        json!({ "image": PNG, "mediaType": "image/png", "width": 2, "height": 1, "scale": 2.0,
            "asleep": true })
    );
    // The surface is the manifest's main when the call names none, and the bound passes through.
    let asked = held.asked.lock().unwrap().clone();
    assert_eq!(
        asked,
        [(HELLO.to_owned(), "main".to_owned(), (Some(640), None))]
    );
}

#[test]
fn it_needs_ui_surface() {
    let held = Arc::new(Held::default());
    let core = core_with(&held);
    let refused = snapshot(&core, HELLO, json!({ "plugin": HELLO, "scope": scope() })).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied, "{refused:?}");
    assert_eq!(
        serde_json::to_value(refused.permission).unwrap(),
        scope(),
        "the missing permission is named"
    );
    // ui:notify does not cover it, and the desk itself holds nothing until it is granted.
    grant(&core, HELLO, json!({ "permission": "ui:notify" }));
    assert!(snapshot(&core, HELLO, json!({ "plugin": HELLO, "scope": scope() })).is_err());
    assert!(snapshot(&core, "desk", json!({ "plugin": HELLO, "scope": scope() })).is_err());
    assert!(held.asked.lock().unwrap().is_empty(), "nothing was read");
}

#[test]
fn a_plugin_snapshots_only_its_own_surfaces() {
    let held = Arc::new(Held::default());
    let core = core_with(&held);
    grant(&core, OTHER, scope());
    let refused = snapshot(&core, OTHER, json!({ "plugin": HELLO, "scope": scope() })).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied, "{refused:?}");
    assert!(refused.message.contains("own"), "{}", refused.message);
    assert!(held.asked.lock().unwrap().is_empty(), "nothing was read");
    // Its own surface it may: here it has shown no frame.
    let none = snapshot(&core, OTHER, json!({ "plugin": OTHER, "scope": scope() })).unwrap_err();
    assert_eq!(none.code, ErrorCode::NotFound, "{none:?}");
}

#[test]
fn the_desk_an_agent_and_the_cli_snapshot_any_surface() {
    let held = Arc::new(Held::default());
    let core = core_with(&held);
    for caller in ["desk", "agent:eris-helper", "cli"] {
        grant(&core, caller, scope());
        let shot = snapshot(&core, caller, json!({ "plugin": HELLO, "scope": scope() })).unwrap();
        assert_eq!(shot["image"], PNG, "{caller}");
    }
    let params = json!({ "plugin": HELLO, "surface": "panel", "scope": scope() });
    let missing = snapshot(&core, "desk", params).unwrap_err();
    assert_eq!(missing.code, ErrorCode::NotFound, "{missing:?}");
}

#[test]
fn a_desk_without_a_compositor_answers_unsupported() {
    let core = Core::new(roots(&home("ui-snapshot-none")));
    grant(&core, "desk", scope());
    let refused =
        snapshot(&core, "desk", json!({ "plugin": HELLO, "scope": scope() })).unwrap_err();
    assert_eq!(refused.code, ErrorCode::Unsupported, "{refused:?}");
    // The shell lets go of its compositor (the window closed): the same.
    let held = Arc::new(Held::default());
    core.set_surface_snapshots(Some(held));
    core.set_surface_snapshots(None);
    let gone = snapshot(&core, "desk", json!({ "plugin": HELLO, "scope": scope() })).unwrap_err();
    assert_eq!(gone.code, ErrorCode::Unsupported, "{gone:?}");
}
