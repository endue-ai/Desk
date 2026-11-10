//! An `a11y.action` done to a web surface as a person's input would do it (`accessibility.md`
//! § Actions). Chromium has no action entry for an embedder, so the DOM node goes through the
//! browser's DevTools agent (`a11y_devtools.rs`): `focus` is `DOM.focus`, `scroll-into-view`
//! `DOM.scrollIntoViewIfNeeded`, `set-value` the field focused, its text selected and the new text
//! inserted as typed, `increment` and `decrement` an arrow key on the focused control, `blur` the
//! focus let go; a `click` (and `expand`, `collapse`, `show-context-menu`) scrolls the node into
//! view and presses the middle of its box (`DOM.getBoxModel`) with the mouse. A node DevTools cannot
//! name (in another frame's document) is pressed where its box is, when the action is a press.

use desk_compositor::glam::Vec2;
use desk_compositor::input::messages::{pointer_button, pointer_move};
use desk_compositor::input::{Button, Modifiers};
use desk_surface::generated::{
    CompositorMessage, SurfaceA11yAction, SurfaceA11yActionName as Name,
};
use serde_json::{Value, json};

use super::devtools::{Command, Then};
use super::tree::WebTree;

/// The presses at `at` (the surface's logical pixels) a click with `button` is.
pub fn presses(surface: &str, at: Vec2, button: Button) -> Vec<CompositorMessage> {
    let mods = Modifiers::default();
    vec![
        pointer_move(surface, at, &[], mods),
        pointer_button(surface, at, button, true, &[], 1, mods),
        pointer_button(surface, at, button, false, &[], 1, mods),
    ]
}

/// The middle of a DevTools box model's border quad.
pub fn middle(result: &Value) -> Option<Vec2> {
    let quad = result.pointer("/model/border")?.as_array()?;
    let n: Vec<f64> = quad.iter().filter_map(Value::as_f64).collect();
    let [x0, y0, _, _, x1, y1, ..] = n.as_slice() else {
        return None;
    };
    Some(Vec2::new(
        ((x0 + x1) / 2.0) as f32,
        ((y0 + y1) / 2.0) as f32,
    ))
}

fn button_of(action: Name) -> Button {
    if action == Name::ShowContextMenu {
        Button::Right
    } else {
        Button::Left
    }
}

fn is_press(action: Name) -> bool {
    matches!(
        action,
        Name::Click | Name::Expand | Name::Collapse | Name::ShowContextMenu
    )
}

/// The commands that do `action` to DOM node `dom`.
pub fn perform(dom: i64, action: Name, value: Option<String>) -> Vec<Command> {
    let node = json!({ "backendNodeId": dom });
    let key = |kind: &str, key: &str, code: u32| {
        json!({ "type": kind, "key": key, "code": key, "windowsVirtualKeyCode": code,
            "nativeVirtualKeyCode": code })
    };
    match action {
        Name::Click | Name::Expand | Name::Collapse | Name::ShowContextMenu => vec![
            ("DOM.scrollIntoViewIfNeeded", node.clone(), None),
            (
                "DOM.getBoxModel",
                node,
                Some(Then::Press(button_of(action))),
            ),
        ],
        Name::Focus => vec![("DOM.focus", node, None)],
        Name::ScrollIntoView => vec![("DOM.scrollIntoViewIfNeeded", node, None)],
        Name::Blur => {
            let blur = json!({ "expression": "document.activeElement?.blur()" });
            vec![("Runtime.evaluate", blur, None)]
        }
        Name::SetValue => {
            let select = json!({ "expression": "document.execCommand('selectAll')" });
            let text = json!({ "text": value.unwrap_or_default() });
            vec![
                ("DOM.focus", node, None),
                ("Runtime.evaluate", select, None),
                ("Input.insertText", text, None),
            ]
        }
        Name::Increment | Name::Decrement => {
            let (arrow, code) = if action == Name::Decrement {
                ("ArrowDown", 40)
            } else {
                ("ArrowUp", 38)
            };
            vec![
                ("DOM.focus", node, None),
                (
                    "Input.dispatchKeyEvent",
                    key("rawKeyDown", arrow, code),
                    None,
                ),
                ("Input.dispatchKeyEvent", key("keyUp", arrow, code), None),
            ]
        }
    }
}

/// What starts `action` on a surface whose tree is `tree`: DevTools commands (the node's DOM node
/// is found first), or for a node DevTools cannot name the presses where its box is.
pub fn start(tree: &WebTree, action: &SurfaceA11yAction) -> (Vec<Command>, Vec<CompositorMessage>) {
    let Some((ax, in_page)) = tree.locate(action.node) else {
        return (Vec::new(), Vec::new());
    };
    if in_page {
        let then = Then::Resolve {
            ax,
            action: action.action,
            value: action.value.clone(),
        };
        return (
            vec![("Accessibility.getFullAXTree", json!({}), Some(then))],
            Vec::new(),
        );
    }
    let bounds = tree.node(action.node).and_then(|(_, b)| b);
    match (is_press(action.action), bounds) {
        (true, Some([x, y, w, h])) => {
            let at = Vec2::new((x + w / 2.0) as f32, (y + h / 2.0) as f32);
            (
                Vec::new(),
                presses(&action.surface, at, button_of(action.action)),
            )
        }
        _ => (Vec::new(), Vec::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_box_models_middle_is_where_the_press_goes() {
        let result = json!({ "model": { "border": [10, 20, 110, 20, 110, 60, 10, 60] } });
        assert_eq!(middle(&result), Some(Vec2::new(60.0, 40.0)));
        assert_eq!(middle(&json!({ "model": {} })), None);
    }

    #[test]
    fn a_click_scrolls_the_node_into_view_and_presses_its_box() {
        let all = perform(17, Name::Click, None);
        let methods: Vec<&str> = all.iter().map(|(m, _, _)| *m).collect();
        assert_eq!(methods, ["DOM.scrollIntoViewIfNeeded", "DOM.getBoxModel"]);
        assert_eq!(all[1].1, json!({ "backendNodeId": 17 }));
        assert_eq!(all[1].2, Some(Then::Press(Button::Left)));
        let typed = perform(4, Name::SetValue, Some("Buy milk".into()));
        assert_eq!(
            typed[2],
            ("Input.insertText", json!({ "text": "Buy milk" }), None)
        );
        let menu = perform(4, Name::ShowContextMenu, None);
        assert_eq!(menu[1].2, Some(Then::Press(Button::Right)));
    }

    #[test]
    fn a_click_is_a_move_a_press_and_a_release_at_one_point() {
        let all = presses("s", Vec2::new(5.0, 6.0), Button::Left);
        assert!(matches!(all[0], CompositorMessage::SurfacePointerMove(_)));
        assert!(
            matches!(&all[1], CompositorMessage::SurfacePointerDown(d) if d.x == 5.0 && d.y == 6.0)
        );
        assert!(matches!(all[2], CompositorMessage::SurfacePointerUp(_)));
    }
}
