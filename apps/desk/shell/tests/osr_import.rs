//! Acceptance (#52): a page of one known colour, and a WebGPU page clearing to another, reach the
//! compositor's texture for their surface from an off-screen CEF browser, through the shared texture
//! on a GPU and through the software path when shared textures are off (CI without a GPU). Each
//! surface's page is the top of its own browser, sandboxed as its frame was (an opaque origin), with
//! `window.parent` speaking for the desk. Runs the shell's surface probe (`src/probe.rs`).

mod support;

use std::sync::OnceLock;

use serde_json::Value;
use support::{near, probe};

fn shared() -> Option<&'static Value> {
    static REPORT: OnceLock<Option<Value>> = OnceLock::new();
    REPORT
        .get_or_init(|| probe("osr_import", "import", &[]))
        .as_ref()
}

fn software() -> Option<&'static Value> {
    static REPORT: OnceLock<Option<Value>> = OnceLock::new();
    REPORT
        .get_or_init(|| probe("osr_import", "import", &[("DESK_SURFACE_SOFTWARE", "1")]))
        .as_ref()
}

#[test]
fn a_known_colour_page_reaches_its_surfaces_texture() {
    let Some(report) = shared() else { return };
    assert_eq!(report["started"], true, "{report}");
    let colour = &report["surfaces"]["colour"];
    assert!(
        near(&colour["middle"], &report["expected"]["colour"]),
        "{colour}"
    );
    let counts = &colour["counts"];
    let paints = counts["paints"].as_u64().unwrap_or(0);
    assert!(
        paints >= 1 || counts["software_paints"].as_u64() >= Some(1),
        "{counts}"
    );
    assert_eq!(counts["import_errors"], 0, "{counts}");
    if paints == 0 {
        eprintln!(
            "a_known_colour_page_reaches_its_surfaces_texture: software paints only (no GPU here)"
        );
    }
    assert_eq!(
        colour["counts"]["texture"],
        serde_json::json!([640, 400]),
        "320 x 200 at scale 2"
    );
}

#[test]
fn a_webgpu_page_paints_through_the_same_path() {
    let Some(report) = shared() else { return };
    let webgpu = &report["surfaces"]["webgpu"];
    let title = webgpu["title"].as_str().unwrap_or_default();
    if title.contains("gpu:none") {
        eprintln!(
            "a_webgpu_page_paints_through_the_same_path: skipped, no WebGPU adapter here ({title})"
        );
        return;
    }
    assert!(title.contains("gpu:"), "{webgpu}");
    assert!(
        near(&webgpu["middle"], &report["expected"]["webgpu"]),
        "{webgpu}"
    );
    assert!(
        webgpu["counts"]["paints"].as_u64() >= Some(5),
        "it animates: {webgpu}"
    );
}

#[test]
fn a_frames_damage_is_what_changed_and_passes_through() {
    let Some(report) = shared() else { return };
    let dot = &report["surfaces"]["dot"]["counts"];
    let texture = 640 * 400;
    let damage = dot["damage_px"].as_u64().unwrap_or(u64::MAX);
    assert!(dot["paints"].as_u64() >= Some(5), "{dot}");
    // A 16 x 16 square at scale 2 changes; the rest of the page does not.
    assert!(
        damage < texture / 4,
        "only the square is damaged: {damage} of {texture} pixels"
    );
}

#[test]
fn the_software_path_reaches_the_same_texture() {
    let Some(report) = software() else { return };
    assert_eq!(report["software"], true);
    let colour = &report["surfaces"]["colour"];
    assert!(
        near(&colour["middle"], &report["expected"]["colour"]),
        "{colour}"
    );
    assert_eq!(
        colour["counts"]["paints"], 0,
        "no shared textures: {colour}"
    );
    assert!(
        colour["counts"]["software_paints"].as_u64() >= Some(1),
        "{colour}"
    );
}

#[test]
fn a_surfaces_page_is_sandboxed_as_its_frame_was_and_its_parent_is_the_desk() {
    let Some(report) = shared() else { return };
    for name in ["colour", "webgpu"] {
        let title = report["surfaces"][name]["title"]
            .as_str()
            .unwrap_or_default();
        assert!(
            title.contains("parent:true"),
            "window.parent is the desk: {title}"
        );
        assert!(
            title.contains("origin:null"),
            "an opaque origin (sandbox allow-scripts): {title}"
        );
    }
    let up = report["relayed"][1].as_u64().unwrap_or(0);
    assert!(
        up >= 2,
        "each page's postMessage to its parent reached the relay: {report}"
    );
}
