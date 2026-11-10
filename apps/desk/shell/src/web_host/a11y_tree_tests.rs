use super::*;
use serde_json::json;

const MAIN: &str = "9D9444EE330F48C7D4DF15F10D49F329";

/// CEF's first `OnAccessibilityTreeChange` of a page, at device scale 2: a document whose body
/// holds a heading (its static text and a text run), a button, and a list scrolled by nothing yet.
fn first() -> Value {
    json!({ "ax_tree_id": MAIN, "events": [{ "event_type": "loadComplete", "id": 1 }],
        "updates": [{ "has_tree_data": true, "root_id": 1,
            "tree_data": { "tree_id": MAIN, "focus_id": 1, "focused_tree_id": MAIN, "title": "Notes" },
            "nodes": [
                { "id": 1, "role": "rootWebArea", "child_ids": [32], "offset_container_id": 0,
                  "attributes": { "name": "Notes", "scrollX": 0, "scrollY": 0 },
                  "location": { "x": 0.0, "y": 0.0, "width": 800.0, "height": 600.0 }, "state": ["focusable"] },
                { "id": 32, "role": "genericContainer", "child_ids": [2, 7, 11], "offset_container_id": 1,
                  "location": { "x": 0.0, "y": 0.0, "width": 800.0, "height": 0.0 }, "state": ["ignored"] },
                { "id": 2, "role": "heading", "child_ids": [3], "offset_container_id": 1,
                  "attributes": { "name": "Shopping", "hierarchicalLevel": 1 },
                  "location": { "x": 32.0, "y": 16.0, "width": 180.0, "height": 56.0 } },
                { "id": 3, "role": "staticText", "child_ids": [-1000000002], "offset_container_id": 2,
                  "attributes": { "name": "Shopping" },
                  "location": { "x": 0.0, "y": -4.0, "width": 180.0, "height": 47.0 } },
                { "id": -1000000002, "role": "inlineTextBox", "offset_container_id": 3,
                  "location": { "x": 0.0, "y": 0.0, "width": 180.0, "height": 47.0 } },
                { "id": 7, "role": "button", "offset_container_id": 1, "state": ["focusable"],
                  "attributes": { "name": "Add", "defaultActionVerb": "press" },
                  "location": { "x": 400.0, "y": 120.0, "width": 160.0, "height": 56.0 } },
                { "id": 11, "role": "list", "child_ids": [12], "offset_container_id": 1,
                  "attributes": { "name": "Items", "scrollable": true, "scrollX": 0, "scrollY": 0 },
                  "location": { "x": 32.0, "y": 300.0, "width": 400.0, "height": 200.0 } },
                { "id": 12, "role": "listItem", "offset_container_id": 11,
                  "attributes": { "name": "Item 20" },
                  "location": { "x": 0.0, "y": 1140.0, "width": 400.0, "height": 60.0 } }
            ] }] })
}

fn by_name<'a>(update: &'a SurfaceA11yUpdate, name: &str) -> &'a SurfaceA11yNode {
    let words = |n: &SurfaceA11yNode| n.name.clone().or_else(|| n.value.clone());
    (update.nodes.iter())
        .find(|n| words(n).as_deref() == Some(name))
        .expect(name)
}

fn rect(b: &Option<desk_surface::generated::SurfaceRect>) -> [f64; 4] {
    let b = b.as_ref().expect("a box");
    [b.x, b.y, b.width, b.height]
}

#[test]
fn the_first_update_is_the_whole_tree_in_logical_pixels_without_text_runs() {
    let mut tree = WebTree::default();
    tree.events(&first());
    let update = tree.update("s-7", 2.0).expect("an update");
    let root = update.tree.as_ref().expect("the tree").root;
    assert_eq!(update.focus, root, "the document has the focus");
    assert_eq!(update.nodes.len(), 7, "no text run");
    let doc = (update.nodes.iter())
        .find(|n| n.id == root)
        .expect("the root");
    assert_eq!(
        (doc.role.as_str(), rect(&doc.bounds)),
        ("root-web-area", [0.0, 0.0, 400.0, 300.0])
    );
    assert_eq!(
        rect(&by_name(&update, "Add").bounds),
        [200.0, 60.0, 80.0, 28.0]
    );
    // The static text's box is relative to its heading's.
    let text = (update.nodes.iter())
        .find(|n| n.role == "label")
        .expect("the heading's text");
    assert_eq!(text.value.as_deref(), Some("Shopping"));
    assert_eq!(rect(&text.bounds)[..2], [16.0, 6.0]);
    // An item in the list is relative to the list, which has not scrolled.
    assert_eq!(rect(&by_name(&update, "Item 20").bounds)[1], 720.0);
    assert!(tree.update("s-7", 2.0).is_none(), "nothing changed");
}

#[test]
fn a_change_goes_out_alone_and_a_scrolled_container_moves_whats_in_it() {
    let mut tree = WebTree::default();
    tree.events(&first());
    tree.update("s-7", 2.0);
    tree.events(
        &json!({ "ax_tree_id": MAIN, "events": [{ "event_type": "focus", "id": 7 }],
        "updates": [{ "nodes": [{ "id": 7, "role": "button", "offset_container_id": 1,
            "state": ["focusable"], "attributes": { "name": "Add!" },
            "location": { "x": 400.0, "y": 120.0, "width": 160.0, "height": 56.0 } }] }] }),
    );
    let update = tree.update("s-7", 2.0).expect("an update");
    assert!(update.tree.is_none());
    assert_eq!(update.nodes.len(), 1);
    assert_eq!(
        update.focus, update.nodes[0].id,
        "the focus event moved the focus"
    );
    tree.scrolled(11, 0, 1000);
    assert_eq!(tree.scrollers(), [11]);
    let update = tree.update("s-7", 2.0).expect("an update");
    assert_eq!(rect(&by_name(&update, "Item 20").bounds)[1], 220.0);
}

#[test]
fn a_location_change_moves_a_node_and_a_cleared_subtree_goes() {
    let mut tree = WebTree::default();
    tree.events(&first());
    let before = tree.update("s-7", 2.0).expect("an update");
    let add = by_name(&before, "Add").id;
    tree.locations(&json!([{ "ax_tree_id": MAIN, "id": 7,
        "new_location": { "offset_container_id": 1, "bounds": { "x": 0.0, "y": 0.0, "width": 10.0, "height": 10.0 } } }]));
    let moved = tree.update("s-7", 2.0).expect("an update");
    assert_eq!(rect(&by_name(&moved, "Add").bounds), [0.0, 0.0, 5.0, 5.0]);
    assert_eq!(by_name(&moved, "Add").id, add, "the same node keeps its id");
    tree.events(&json!({ "ax_tree_id": MAIN, "updates": [{ "node_id_to_clear": 2,
        "nodes": [{ "id": 2, "role": "heading", "offset_container_id": 1,
            "attributes": { "name": "Shopping" }, "location": { "x": 32.0, "y": 16.0, "width": 180.0, "height": 56.0 } }] }] }));
    tree.update("s-7", 2.0);
    assert!(
        !tree.trees[MAIN].nodes.contains_key(&3),
        "the heading's text went with the clear"
    );
}

#[test]
fn an_iframes_document_is_stitched_in_at_the_iframe_and_a_new_document_replaces_the_tree() {
    let mut tree = WebTree::default();
    let mut page = first();
    let nodes = page["updates"][0]["nodes"].as_array_mut().expect("nodes");
    nodes[1]["child_ids"] = json!([2, 7, 11, 40]);
    nodes.push(
        json!({ "id": 40, "role": "iframe", "offset_container_id": 1,
        "attributes": { "childTreeId": "CHILD" },
        "location": { "x": 100.0, "y": 200.0, "width": 200.0, "height": 100.0 } }),
    );
    tree.events(&page);
    tree.events(&json!({ "ax_tree_id": "CHILD", "updates": [{ "root_id": 1, "has_tree_data": true,
        "tree_data": { "tree_id": "CHILD", "parent_tree_id": MAIN },
        "nodes": [{ "id": 1, "role": "rootWebArea", "child_ids": [2], "location": { "x": 0.0, "y": 0.0, "width": 200.0, "height": 100.0 } },
                  { "id": 2, "role": "button", "offset_container_id": 1, "attributes": { "name": "Inner" },
                    "location": { "x": 10.0, "y": 10.0, "width": 20.0, "height": 20.0 } }] }] }));
    let update = tree.update("s", 2.0).expect("an update");
    let inner = by_name(&update, "Inner");
    assert_eq!(rect(&inner.bounds), [55.0, 105.0, 10.0, 10.0]);
    assert_eq!(
        tree.locate(inner.id).map(|(_, in_page)| in_page),
        Some(false)
    );
    // The page navigated: a new document's tree, the old ones gone.
    tree.events(
        &json!({ "ax_tree_id": "NEW", "updates": [{ "root_id": 1, "has_tree_data": true,
        "tree_data": { "tree_id": "NEW" },
        "nodes": [{ "id": 1, "role": "rootWebArea", "attributes": { "name": "Next" } }] }] }),
    );
    let update = tree.update("s", 2.0).expect("an update");
    assert!(update.tree.is_some(), "a new root");
    assert_eq!(update.nodes.len(), 1);
    assert!(!tree.trees.contains_key(MAIN));
}
