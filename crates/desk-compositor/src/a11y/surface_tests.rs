use super::*;
use accesskit::{Action, Role};
use serde_json::json;

fn update(json: serde_json::Value) -> SurfaceA11yUpdate {
    serde_json::from_value(json).expect("an a11y.update")
}

#[test]
fn a_node_on_the_wire_is_accesskits_with_every_property_it_has() {
    let n: SurfaceA11yNode = serde_json::from_value(json!({
        "id": 9, "role": "slider", "name": "Volume", "description": "Loudness",
        "numericValue": 0.4, "minNumericValue": 0, "maxNumericValue": 1,
        "actions": ["increment", "decrement", "focus"], "disabled": true, "level": 3,
        "bounds": { "x": 10, "y": 20, "width": 30, "height": 4 }
    }))
    .expect("a node");
    let node = node_of(&n, &[1, 2]);
    assert_eq!(node.role(), Role::Slider);
    assert_eq!(node.label(), Some("Volume"));
    assert_eq!(node.description(), Some("Loudness"));
    assert_eq!(node.numeric_value(), Some(0.4));
    assert_eq!(node.max_numeric_value(), Some(1.0));
    assert!(node.supports_action(Action::Increment) && !node.supports_action(Action::Click));
    assert!(node.is_disabled());
    assert_eq!(node.level(), Some(3));
    assert_eq!(node.bounds(), Some(Rect::new(10.0, 20.0, 40.0, 24.0)));
    assert_eq!(node.children(), [NodeId(1), NodeId(2)]);
}

#[test]
fn a_checkbox_says_its_state_and_a_box_that_is_not_finite_is_left_out() {
    let n: SurfaceA11yNode = serde_json::from_value(json!({
        "id": 6, "role": "check-box", "toggled": "mixed", "expanded": false, "selected": true
    }))
    .expect("a node");
    let mut n = n;
    n.bounds = Some(desk_surface::generated::SurfaceRect {
        x: f64::NAN,
        y: 0.0,
        width: 1.0,
        height: 1.0,
    });
    let node = node_of(&n, &[]);
    assert_eq!(node.toggled(), Some(Toggled::Mixed));
    assert_eq!(node.is_expanded(), Some(false));
    assert_eq!(node.is_selected(), Some(true));
    assert_eq!(node.bounds(), None);
}

#[test]
fn an_update_merges_and_a_new_root_is_a_new_generation() {
    let mut tree = SurfaceTree::default();
    tree.apply(update(
        json!({ "type": "a11y.update", "surface": "s", "tree": { "root": 1 },
        "nodes": [{ "id": 1, "role": "root-web-area", "children": [2] },
                  { "id": 2, "role": "button", "name": "Old" }], "focus": 2 }),
    ));
    assert_eq!(
        (tree.len(), tree.focus(), tree.generation()),
        (2, Some(2), 1)
    );
    tree.apply(update(json!({ "type": "a11y.update", "surface": "s",
        "nodes": [{ "id": 2, "role": "button", "name": "New" }], "focus": 7 })));
    assert_eq!(tree.node(2).and_then(|n| n.name.as_deref()), Some("New"));
    assert_eq!(tree.focus(), Some(1), "a focus on no node is the root");
    assert_eq!(tree.generation(), 1, "the same root");
    tree.apply(update(
        json!({ "type": "a11y.update", "surface": "s", "tree": { "root": 5 },
        "nodes": [{ "id": 5, "role": "root-web-area", "children": [2] }], "focus": 5 }),
    ));
    assert_eq!(
        (tree.len(), tree.root(), tree.generation()),
        (2, Some(5), 2)
    );
    assert!(tree.node(1).is_none(), "the old root no longer reached");
}

#[test]
fn the_walk_keeps_each_node_once_and_stops_at_the_cap() {
    let mut nodes = vec![
        json!({ "id": 0, "role": "list", "children": (1..=MAX_NODES as u64 + 5).collect::<Vec<_>>() }),
    ];
    nodes.extend(
        (1..=MAX_NODES as u64 + 5)
            .map(|id| json!({ "id": id, "role": "list-item", "children": [0, 1] })),
    );
    let mut tree = SurfaceTree::default();
    tree.apply(update(
        json!({ "type": "a11y.update", "surface": "s", "tree": { "root": 0 },
        "nodes": nodes, "focus": 0 }),
    ));
    let walk = tree.walk();
    assert_eq!(walk.len(), MAX_NODES);
    assert!(walk.iter().skip(1).all(|(_, children)| children.is_empty()));
    assert_eq!(tree.len(), MAX_NODES, "what the cap leaves out is gone");
}
