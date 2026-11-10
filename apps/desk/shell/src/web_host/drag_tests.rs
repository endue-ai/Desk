use desk_surface::generated::CompositorMessage;
use serde_json::{Value, json};

use super::{DragIds, Up};

fn down(ids: &mut DragIds, message: Value) -> Value {
    let message: CompositorMessage = serde_json::from_value(message).unwrap();
    serde_json::from_str(&ids.down(&message).expect("a message for the page")).unwrap()
}

fn taken(up: Up) -> Vec<Value> {
    match up {
        Up::Take(all) | Up::Both(all) => all
            .iter()
            .map(|m| serde_json::to_value(m).unwrap())
            .collect(),
        other => panic!("not taken: {other:?}"),
    }
}

#[test]
fn the_sdks_start_and_types_reach_the_broker_and_its_moves_do_not() {
    let mut ids = DragIds::default();
    let start = json!({ "type": "desk:drag-start", "drag": 7, "x": 1, "y": 2,
        "items": [{ "type": "desk/text", "text": "hi" }] });
    let said = taken(ids.up("a.one", &start.to_string()));
    assert_eq!(said[0]["type"], "drag.start");
    assert_eq!(
        said[0]["effectAllowed"],
        json!(["copy", "move", "link"]),
        "every effect by default"
    );
    let types = json!({ "type": "desk:drop-types", "types": ["desk/paths"] });
    assert_eq!(
        taken(ids.up("a.one", &types.to_string()))[0]["types"],
        json!(["desk/paths"])
    );
    let moved = json!({ "type": "desk:drag-move", "drag": 7, "x": 3, "y": 4 });
    assert!(taken(ids.up("a.one", &moved.to_string())).is_empty());
    assert_eq!(
        ids.up("a.one", r#"{"type":"desk:calls","calls":[]}"#),
        Up::Pass
    );
    // The page started over: its types are forgotten, and the runtime hears its hello too.
    assert!(matches!(
        ids.up("a.one", r#"{"type":"desk:hello"}"#),
        Up::Both(_)
    ));
    // A start whose items do not even parse ends at once.
    let bad = json!({ "type": "desk:drag-start", "drag": 8, "items": [{ "type": "nonsense" }] });
    let Up::Answer(ended) = ids.up("a.one", &bad.to_string()) else {
        panic!()
    };
    assert_eq!(
        serde_json::from_str::<Value>(&ended).unwrap(),
        json!({ "type": "desk:drag-ended", "drag": 8, "effect": "none" })
    );
}

#[test]
fn a_hover_carries_the_sdks_ids_and_only_the_answer_to_the_last_one_goes_up() {
    let mut ids = DragIds::default();
    let enter = down(
        &mut ids,
        json!({ "type": "drag.enter", "surface": "b.two", "x": 5, "y": 6, "types": ["desk/text"],
        "effectAllowed": ["copy"], "modifiers": ["alt"], "from": "a" }),
    );
    assert_eq!(
        (
            enter["type"].clone(),
            enter["drag"].clone(),
            enter["seq"].clone()
        ),
        (json!("desk:dragenter"), json!(1), json!(1))
    );
    assert_eq!(
        enter["keys"],
        json!({ "alt": true, "shift": false, "ctrl": false, "meta": false })
    );
    let over = down(
        &mut ids,
        json!({ "type": "drag.over", "surface": "b.two", "x": 7, "y": 6, "modifiers": [] }),
    );
    assert_eq!(over["seq"], 2);
    let stale = json!({ "type": "desk:drag-status", "drag": 1, "seq": 1, "effect": "copy" });
    assert!(taken(ids.up("b.two", &stale.to_string())).is_empty());
    let last = json!({ "type": "desk:drag-status", "drag": 1, "seq": 2, "effect": "copy" });
    let said = taken(ids.up("b.two", &last.to_string()));
    assert_eq!(
        said,
        [json!({ "type": "drag.status", "surface": "b.two", "effect": "copy" })]
    );
    let drop = down(
        &mut ids,
        json!({ "type": "drag.drop", "surface": "b.two", "x": 7, "y": 6, "effect": "copy",
        "items": [{ "type": "desk/text", "text": "hi" }] }),
    );
    assert_eq!(
        (drop["type"].clone(), drop["drag"].clone()),
        (json!("desk:drop"), json!(1))
    );
    let done = json!({ "type": "desk:drop-done", "drag": 1, "effect": "copy" });
    let said = taken(ids.up("b.two", &done.to_string()));
    assert_eq!(said[0]["type"], "drag.done");
    // The next drag over it has the next id.
    let enter = down(
        &mut ids,
        json!({ "type": "drag.enter", "surface": "b.two", "x": 0, "y": 0, "types": ["desk/text"],
        "effectAllowed": ["copy"], "modifiers": [], "from": "os" }),
    );
    assert_eq!(enter["drag"], 2);
}

#[test]
fn the_source_hears_how_its_drag_ended_by_its_own_id() {
    let mut ids = DragIds::default();
    let start = json!({ "type": "desk:drag-start", "drag": 41, "items": [{ "type": "desk/text", "text": "hi" }] });
    ids.up("a.one", &start.to_string());
    let ended = down(
        &mut ids,
        json!({ "type": "drag.ended", "surface": "a.one", "effect": "move", "to": "b" }),
    );
    assert_eq!(
        ended,
        json!({ "type": "desk:drag-ended", "drag": 41, "effect": "move", "to": "b" })
    );
    let again: CompositorMessage = serde_json::from_value(
        json!({ "type": "drag.ended", "surface": "a.one", "effect": "none" }),
    )
    .unwrap();
    assert_eq!(ids.down(&again), None, "once");
}
