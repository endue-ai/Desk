use serde_json::{Value, json};

use super::{Act, Drags};

const OWNER: &str = "endue.notes";

fn up(drags: &mut Drags, m: Value) -> Vec<Act> {
    drags.up(&m).expect("about drags")
}

/// The messages to the page among `acts`, by type.
fn types(acts: &[Act]) -> Vec<String> {
    acts.iter()
        .map(|a| match a {
            Act::Page(m) => m["type"].as_str().unwrap_or("?").to_owned(),
            Act::Open(_) => "open".to_owned(),
            Act::Wait => "wait".to_owned(),
        })
        .collect()
}

fn page(acts: &[Act], kind: &str) -> Value {
    acts.iter()
        .find_map(|a| match a {
            Act::Page(m) if m["type"] == kind => Some(m.clone()),
            _ => None,
        })
        .unwrap_or_else(|| panic!("no {kind} in {acts:?}"))
}

fn over(x: f64, y: f64) -> Value {
    json!({ "type": "desk:os-dragover", "x": x, "y": y, "keys": { "alt": false } })
}

fn notes() -> Drags {
    let mut drags = Drags::new(OWNER);
    drags.set_size(400.0, 300.0);
    up(
        &mut drags,
        json!({ "type": "desk:drop-types", "types": ["desk/paths", "text/plain"] }),
    );
    drags
}

#[test]
fn a_file_from_the_os_lands_on_the_target_that_answers_an_effect() {
    let mut drags = notes();
    assert!(
        drags
            .os_enter(vec!["/Docs/a.md".into(), "relative.md".into()])
            .is_empty()
    );
    let entered = up(&mut drags, over(10.0, 20.0));
    let enter = page(&entered, "desk:dragenter");
    assert_eq!(enter["from"], "os");
    assert_eq!(enter["types"], json!(["desk/paths", "text/plain"]));
    assert_eq!(enter["effectAllowed"], json!(["copy", "link"]));
    // The page learns the types, never the paths, until it drops them.
    assert!(!entered.iter().any(|a| format!("{a:?}").contains("/Docs")));
    let id = enter["drag"].clone();
    let answer =
        |seq: u64| json!({ "type": "desk:drag-status", "drag": id, "seq": seq, "effect": "copy" });
    assert!(
        up(&mut drags, answer(1)).is_empty(),
        "no feedback for the OS"
    );
    let released = up(
        &mut drags,
        json!({ "type": "desk:os-drop", "x": 12, "y": 20 }),
    );
    assert_eq!(types(&released), ["desk:dragover", "wait"]);
    let landed = up(&mut drags, answer(2));
    let drop = page(&landed, "desk:drop");
    assert_eq!(drop["effect"], "copy");
    assert_eq!(drop["items"][0]["paths"][0]["path"], "/Docs/a.md");
    assert_eq!(
        drop["items"].as_array().map(Vec::len),
        Some(2),
        "and the plain text"
    );
    // Gone once dropped: a second drop opens nothing.
    assert!(
        up(
            &mut drags,
            json!({ "type": "desk:os-drop", "x": 1, "y": 1 })
        )
        .is_empty()
    );
}

#[test]
fn a_file_from_the_os_the_page_does_not_take_opens_as_on_the_canvas() {
    // No target takes paths: the page hears nothing, and the drop opens the file.
    let mut drags = Drags::new(OWNER);
    drags.os_enter(vec!["/Docs/a.png".into()]);
    assert!(up(&mut drags, over(10.0, 20.0)).is_empty());
    let released = up(
        &mut drags,
        json!({ "type": "desk:os-drop", "x": 10, "y": 20 }),
    );
    assert_eq!(released, vec![Act::Open(vec!["/Docs/a.png".into()])]);
    // A target that answers none: it hears the drag leave, and the file opens.
    let mut drags = notes();
    drags.os_enter(vec!["/Docs/a.png".into()]);
    let id = page(&up(&mut drags, over(10.0, 20.0)), "desk:dragenter")["drag"].clone();
    up(
        &mut drags,
        json!({ "type": "desk:os-drop", "x": 10, "y": 20 }),
    );
    let none = json!({ "type": "desk:drag-status", "drag": id, "seq": 2, "effect": "none" });
    let landed = up(&mut drags, none);
    assert_eq!(types(&landed), ["desk:dragleave", "open"]);
    // A page that never answers: after the wait, the last answer stands.
    let mut drags = notes();
    drags.os_enter(vec!["/Docs/b.png".into()]);
    up(&mut drags, over(10.0, 20.0));
    up(
        &mut drags,
        json!({ "type": "desk:os-drop", "x": 10, "y": 20 }),
    );
    assert_eq!(types(&drags.settle()), ["desk:dragleave", "open"]);
}

#[test]
fn only_the_os_drag_that_entered_opens_once_and_a_page_cannot_make_one_up() {
    let mut drags = notes();
    // No OS drag entered: a page's own word moves nothing and opens nothing.
    assert!(up(&mut drags, over(10.0, 20.0)).is_empty());
    assert!(
        up(
            &mut drags,
            json!({ "type": "desk:os-drop", "x": 1, "y": 1 })
        )
        .is_empty()
    );
    // Paths that do not hold are not offered at all.
    assert!(
        drags
            .os_enter(vec!["relative.md".into(), "/a/../b".into()])
            .is_empty()
    );
    assert!(
        up(
            &mut drags,
            json!({ "type": "desk:os-drop", "x": 1, "y": 1 })
        )
        .is_empty()
    );
    // One that left is gone: a drop after it opens nothing.
    drags.os_enter(vec!["/Docs/a.md".into()]);
    up(&mut drags, over(10.0, 20.0));
    assert_eq!(
        types(&up(&mut drags, json!({ "type": "desk:os-dragleave" }))),
        ["desk:dragleave"]
    );
    assert!(
        up(
            &mut drags,
            json!({ "type": "desk:os-drop", "x": 1, "y": 1 })
        )
        .is_empty()
    );
}

#[test]
fn a_drag_the_page_starts_lands_on_its_own_target_and_ends_with_the_effect() {
    let mut drags = Drags::new(OWNER);
    drags.set_size(400.0, 300.0);
    up(
        &mut drags,
        json!({ "type": "desk:drop-types", "types": ["desk/json"] }),
    );
    let items = json!([{ "type": "desk/json", "kind": "db/rows", "value": [1, 2] }]);
    let start = json!({ "type": "desk:drag-start", "drag": 7, "items": items, "x": 5, "y": 5 });
    let enter = page(&up(&mut drags, start), "desk:dragenter");
    assert_eq!(enter["from"], OWNER);
    assert_eq!(enter["types"], json!(["desk/json:db/rows"]));
    let id = enter["drag"].clone();
    let answer =
        |seq: u64| json!({ "type": "desk:drag-status", "drag": id, "seq": seq, "effect": "move" });
    let feedback = page(&up(&mut drags, answer(1)), "desk:drag-feedback");
    assert_eq!(
        (feedback["drag"].clone(), feedback["effect"].clone()),
        (json!(7), json!("move"))
    );
    let end = json!({ "type": "desk:drag-end", "drag": 7, "x": 50, "y": 60, "keys": {} });
    assert_eq!(types(&up(&mut drags, end)), ["desk:dragover", "wait"]);
    let drop = page(&up(&mut drags, answer(2)), "desk:drop");
    assert_eq!(drop["items"][0]["kind"], "db/rows");
    let done = json!({ "type": "desk:drop-done", "drag": id, "effect": "move" });
    let ended = page(&up(&mut drags, done), "desk:drag-ended");
    assert_eq!(
        ended,
        json!({ "type": "desk:drag-ended", "drag": 7, "effect": "move", "to": OWNER })
    );
}

#[test]
fn a_drag_the_page_starts_cannot_leave_the_window() {
    let mut drags = notes();
    let items = json!([{ "type": "desk/text", "text": "hello" }]);
    let start = json!({ "type": "desk:drag-start", "drag": 3, "items": items, "x": 5, "y": 5 });
    assert_eq!(types(&up(&mut drags, start)), ["desk:dragenter"]);
    // Past the window's edge it is over nothing; let go there, it ends with none.
    let out = json!({ "type": "desk:drag-move", "drag": 3, "x": 500, "y": 10 });
    assert_eq!(
        types(&up(&mut drags, out)),
        ["desk:dragleave", "desk:drag-feedback"]
    );
    let end = json!({ "type": "desk:drag-end", "drag": 3, "x": 520, "y": 10 });
    let ended = page(&up(&mut drags, end), "desk:drag-ended");
    assert_eq!(
        ended,
        json!({ "type": "desk:drag-ended", "drag": 3, "effect": "none" })
    );
    // A start that does not hold ends at once.
    let bad = json!([{ "type": "desk/paths", "paths": [{ "path": "relative" }] }]);
    let refused = up(
        &mut drags,
        json!({ "type": "desk:drag-start", "drag": 4, "items": bad }),
    );
    assert_eq!(page(&refused, "desk:drag-ended")["effect"], "none");
}

#[test]
fn what_is_not_about_drags_goes_to_the_runtime_and_a_page_that_starts_over_takes_nothing() {
    let mut drags = notes();
    assert!(drags.up(&json!({ "type": "desk:calls" })).is_none());
    assert!(drags.up(&json!({ "type": "desk:hello" })).is_none());
    drags.os_enter(vec!["/Docs/a.md".into()]);
    assert!(
        up(&mut drags, over(10.0, 20.0)).is_empty(),
        "it accepts nothing yet"
    );
}
