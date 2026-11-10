use super::*;
use serde_json::json;

/// A node in the shape CEF 156 writes (`CefWriteJSON` of `osr_accessibility_util`'s dictionary).
fn node(v: serde_json::Value) -> AxNode {
    AxNode::parse(&v).expect("a node").1
}

#[test]
fn cefs_node_is_read_with_its_box_its_container_and_its_states() {
    let (id, n) = AxNode::parse(&json!({
        "attributes": { "name": "Add", "htmlTag": "button", "defaultActionVerb": "press" },
        "child_ids": [8, -1000000002], "id": 7, "role": "button",
        "location": { "height": 56.0, "width": 160.0, "x": 400.0, "y": 120.0 },
        "offset_container_id": 1, "state": ["focusable", "", ""]
    }))
    .expect("a node");
    assert_eq!(id, 7);
    assert_eq!(n.bounds, [400.0, 120.0, 160.0, 56.0]);
    assert_eq!(n.offset_container, Some(1));
    assert_eq!(n.children, [8, -1000000002]);
    assert!(n.has("focusable") && !n.has(""));
    assert_eq!(n.role(), "button");
    assert_eq!(n.actions("button"), [Name::Click, Name::Focus, Name::Blur]);
}

#[test]
fn chromiums_roles_become_accesskits_and_what_means_nothing_a_generic_container() {
    let role = |r: &str, attributes: serde_json::Value, state: serde_json::Value| {
        node(json!({ "id": 1, "role": r, "attributes": attributes, "state": state })).role()
    };
    let none = json!({});
    assert_eq!(role("staticText", none.clone(), json!([])), "label");
    assert_eq!(role("textField", none.clone(), json!([])), "text-input");
    assert_eq!(
        role("textField", json!({ "inputType": "email" }), json!([])),
        "email-input"
    );
    assert_eq!(
        role("textField", none.clone(), json!(["multiline"])),
        "multiline-text-input"
    );
    assert_eq!(
        role("rootWebArea", none.clone(), json!([])),
        "root-web-area"
    );
    assert_eq!(role("checkBox", none.clone(), json!([])), "check-box");
    assert_eq!(role("comboBoxSelect", none.clone(), json!([])), "combo-box");
    assert_eq!(role("toggleButton", none.clone(), json!([])), "button");
    assert_eq!(
        role("button", none.clone(), json!(["ignored"])),
        "generic-container"
    );
    assert_eq!(role("none", none.clone(), json!([])), "generic-container");
    assert_eq!(role("neverHeardOf", none, json!([])), "generic-container");
}

#[test]
fn a_node_on_the_wire_has_its_words_state_and_box_and_a_labels_text_is_its_value() {
    let field = node(
        json!({ "id": 4, "role": "textField", "state": ["focusable", "editable"],
        "attributes": { "name": "New item", "placeholder": "Add an item", "value": "milk",
            "restriction": "disabled" } }),
    );
    let wire = field.protocol(5, vec![6], Some([16.0, 60.0, 160.0, 28.0]));
    assert_eq!(
        (wire.role.as_str(), wire.name.as_deref()),
        ("text-input", Some("New item"))
    );
    assert_eq!(wire.value.as_deref(), Some("milk"));
    assert_eq!(wire.placeholder.as_deref(), Some("Add an item"));
    assert_eq!(wire.disabled, Some(true));
    assert_eq!(wire.children, Some(vec![6]));
    assert!(
        wire.actions
            .as_ref()
            .is_some_and(|a| a.contains(&Name::SetValue))
    );
    assert_eq!(wire.bounds.as_ref().map(|b| b.width), Some(160.0));
    let text = node(json!({ "id": 3, "role": "staticText", "attributes": { "name": "Shopping" } }));
    let wire = text.protocol(9, Vec::new(), None);
    assert_eq!((wire.name, wire.value.as_deref()), (None, Some("Shopping")));
    let check = node(
        json!({ "id": 2, "role": "checkBox", "attributes": { "checkedState": "mixed", "name": "Milk" } }),
    );
    assert_eq!(
        check.protocol(1, Vec::new(), None).toggled,
        Some(SurfaceA11yToggled::Mixed)
    );
    let heading = node(json!({ "id": 2, "role": "heading", "state": ["collapsed"],
        "attributes": { "hierarchicalLevel": 2, "name": "Today" } }));
    let wire = heading.protocol(1, Vec::new(), None);
    assert_eq!((wire.level, wire.expanded), (Some(2), Some(false)));
    assert!(wire.actions.is_some_and(|a| a.contains(&Name::Expand)));
}

#[test]
fn a_slider_says_its_range_and_steps_and_an_ignored_node_says_nothing() {
    let slider = node(json!({ "id": 9, "role": "slider", "state": ["focusable"],
        "attributes": { "name": "Volume", "valueForRange": 0.4, "minValueForRange": 0.0,
            "maxValueForRange": 1.0 } }));
    let wire = slider.protocol(9, Vec::new(), None);
    assert_eq!(
        (wire.numeric_value, wire.max_numeric_value),
        (Some(0.4), Some(1.0))
    );
    assert!(
        wire.actions
            .is_some_and(|a| a.contains(&Name::Increment) && a.contains(&Name::Decrement))
    );
    let ignored = node(
        json!({ "id": 3, "role": "button", "state": ["ignored"], "attributes": { "name": "x" } }),
    );
    let wire = ignored.protocol(3, vec![4], None);
    assert_eq!(
        (wire.role.as_str(), wire.name, wire.actions),
        ("generic-container", None, None)
    );
    assert_eq!(wire.children, Some(vec![4]), "its children stay");
}

#[test]
fn a_transform_is_read_from_chromiums_text() {
    let text = "[ +2.0000 +0.0000 +0.0000 +10.0000  \n  +0.0000 +2.0000 +0.0000 +20.0000  \n  \
        +0.0000 +0.0000 +1.0000 +0.0000  \n  +0.0000 +0.0000 +0.0000 +1.0000 ]\n";
    assert_eq!(transform_of(text), Some([2.0, 0.0, 0.0, 2.0, 10.0, 20.0]));
    assert_eq!(transform_of("nonsense"), None);
}
