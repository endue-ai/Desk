//! Acceptance (#57): a web surface's accessibility tree. Silent until `a11y.enable`, the surface
//! then exports its tree from CEF's accessibility events (`web_host/a11y*.rs`), merged as the
//! compositor merges it: a page's heading, text field, button and checkbox with their roles and
//! words, each box in the surface's logical pixels at scale 2; a screen reader's click reaches the
//! page's button, its focus the field (the tree's focus follows), a value typed into the field shows
//! in the tree, and the list's last item scrolled into view moves into the list's box. Asleep and
//! woken, its new browser exports again. Turned off, it exports nothing more. Runs the shell's surface probe (`src/probe/a11y.rs`).

mod support;

use std::sync::OnceLock;

use serde_json::{Value, json};
use support::probe;

fn report() -> Option<&'static Value> {
    static REPORT: OnceLock<Option<Value>> = OnceLock::new();
    REPORT
        .get_or_init(|| {
            let report = probe("a11y", "a11y", &[]);
            if let Some(report) = &report {
                eprintln!("a11y: {report}");
            }
            report
        })
        .as_ref()
}

fn bounds(node: &Value) -> Value {
    node["bounds"].clone()
}

#[test]
fn a_surface_exports_nothing_until_enabled_then_its_tree_with_roles_words_and_boxes() {
    let Some(report) = report() else { return };
    assert_eq!(report["started"], true, "{report}");
    assert_eq!(
        report["silent"], true,
        "no tree before a11y.enable: {report}"
    );
    assert_eq!(report["exported"], true, "{report}");
    let found = &report["found"];
    assert_eq!(found["root"]["role"], "root-web-area");
    assert_eq!(
        bounds(&found["root"]),
        json!({ "x": 0.0, "y": 0.0, "width": 400.0, "height": 300.0 })
    );
    assert_eq!(found["heading"]["level"], 1);
    assert_eq!(found["heading"]["bounds"]["y"], 8.0);
    assert_eq!(found["field"]["placeholder"], "Add an item");
    assert_eq!(
        bounds(&found["field"]),
        json!({ "x": 16.0, "y": 60.0, "width": 160.0, "height": 28.0 })
    );
    assert_eq!(
        bounds(&found["add"]),
        json!({ "x": 200.0, "y": 60.0, "width": 80.0, "height": 28.0 })
    );
    assert!(
        found["add"]["actions"]
            .as_array()
            .is_some_and(|a| a.contains(&json!("click")))
    );
    assert_eq!(found["milk"]["toggled"], "true");
    let outline = found["outline"].as_array().cloned().unwrap_or_default();
    assert!(outline.contains(&json!(["list", "Items"])), "{outline:?}");
    assert!(
        outline.contains(&json!(["label", "Item 20"])),
        "{outline:?}"
    );
}

#[test]
fn a_screen_readers_click_focus_and_value_reach_the_page() {
    let Some(report) = report() else { return };
    assert_eq!(
        report["clicked"], true,
        "the button heard the click: {report}"
    );
    assert_eq!(
        report["focused"], true,
        "the tree's focus moved to the field: {report}"
    );
    assert_eq!(
        report["typed"], true,
        "the field's value is in the tree: {report}"
    );
}

#[test]
fn an_item_scrolled_into_view_moves_into_its_lists_box() {
    let Some(report) = report() else { return };
    assert_eq!(report["scrolled"], true, "{report}");
    let (before, after) = (&report["last"]["before"], &report["last"]["after"]);
    assert!(
        before[0].as_f64() > Some(250.0),
        "below the list at first: {report}"
    );
    assert!(
        after[0].as_f64() >= Some(150.0) && after[1].as_f64() <= Some(250.5),
        "{report}"
    );
}

#[test]
fn a_woken_surfaces_new_browser_exports_again() {
    let Some(report) = report() else { return };
    assert_eq!(
        report["woke"], true,
        "a fresh tree after the wake: {report}"
    );
}

#[test]
fn turned_off_a_surface_exports_nothing_and_takes_no_action() {
    let Some(report) = report() else { return };
    assert_eq!(report["after_off"], 0, "{report}");
    let clicks = &report["clicks"];
    assert_eq!(
        clicks["after"], clicks["before"],
        "no click after a11y.enable false: {report}"
    );
}
