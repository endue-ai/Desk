//! What compositor mode tells checks about accessibility (#57, development builds): the tree as the
//! platform adapter has it, walked the way a screen reader walks it (`compositor_a11y`, AccessKit's
//! consumer fed every update the adapter gets), and a screen reader's request on a node found by
//! its role and label. A check can start the desk's accessibility itself (`activate`), as an
//! assistive technology would: the screen may be locked and no screen reader runs.
//!
//! `compositor_a11y { activate?, deactivate?, act?: { role, label, action, value? } }` answers
//! `{ active, acted, focus, tree }`: each node `{ role, label, value, bounds, children }`, roles in
//! kebab-case and bounds in the window's logical pixels.

use accesskit::{Action, ActionData, ActionRequest, NodeId, Role};
use accesskit_consumer::{NodeRef, common_filter};
use desk_compositor::a11y::{role_name, role_of};
use serde_json::{Value, json};
use winit::event_loop::ActiveEventLoop;

use super::CompositorWindow;
use super::a11y::Asked;

/// A node as a screen reader sees it, at `scale` device pixels to a logical one.
fn seen(node: &NodeRef, scale: f64) -> Value {
    let bounds = node.bounding_box().map(|r| {
        let round = |v: f64| (v / scale * 100.0).round() / 100.0;
        [
            round(r.x0),
            round(r.y0),
            round(r.x1 - r.x0),
            round(r.y1 - r.y0),
        ]
    });
    let children: Vec<Value> = node
        .filtered_children(common_filter)
        .map(|c| seen(&c, scale))
        .collect();
    json!({ "role": role_name(node.role()), "label": node.label(), "value": node.value(),
        "bounds": bounds, "children": children })
}

/// The first node a screen reader meets with `role` and `label`.
fn find(root: NodeRef<'_>, role: Role, label: &str) -> Option<(NodeId, accesskit::TreeId)> {
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        let words = node.label().or_else(|| node.value());
        if node.role() == role && words.as_deref() == Some(label) {
            return Some(node.locate());
        }
        let children: Vec<NodeRef> = node.filtered_children(common_filter).collect();
        stack.extend(children.into_iter().rev());
    }
    None
}

/// An action named as AccessKit's in kebab-case or camelCase (`click`, `set-value`, `scrollDown`).
fn action_of(name: &str) -> Option<Action> {
    let camel: String = name
        .split('-')
        .enumerate()
        .map(|(i, part)| {
            let mut chars = part.chars();
            match chars.next() {
                Some(c) if i > 0 => c.to_uppercase().chain(chars).collect(),
                Some(c) => std::iter::once(c).chain(chars).collect(),
                None => String::new(),
            }
        })
        .collect();
    serde_json::from_value(Value::String(camel)).ok()
}

impl CompositorWindow {
    /// The `compositor_a11y` check.
    pub fn a11y_check(
        &mut self,
        event_loop: &ActiveEventLoop,
        args: &Value,
    ) -> Result<Value, String> {
        if args.get("deactivate").and_then(Value::as_bool) == Some(true) {
            self.a11y_asked(event_loop, Asked::Gone);
        }
        if args.get("activate").and_then(Value::as_bool) == Some(true)
            && !self.a11y.desk.is_active()
        {
            self.a11y_asked(event_loop, Asked::Tree);
        }
        let mut acted = Value::Null;
        if let Some(act) = args.get("act") {
            let role = role_of(act.get("role").and_then(Value::as_str).unwrap_or_default());
            let label = act.get("label").and_then(Value::as_str).unwrap_or_default();
            let name = act.get("action").and_then(Value::as_str).unwrap_or("click");
            let action = action_of(name).ok_or_else(|| format!("no action {name}"))?;
            let tree = self.a11y.shadow.as_ref().ok_or("no tree: activate first")?;
            let (node, tree_id) = find(tree.state().root(), role, label)
                .ok_or_else(|| format!("no {} {label:?} in the tree", role_name(role)))?;
            let data = act
                .get("value")
                .and_then(Value::as_str)
                .map(|v| ActionData::Value(v.into()));
            let request = ActionRequest {
                action,
                target_tree: tree_id,
                target_node: node,
                data,
            };
            self.a11y_request(event_loop, &request);
            acted = json!({ "node": node.0, "tree": tree_id.0.to_string() });
        }
        let scale = self.window.scale_factor();
        let tree = self
            .a11y
            .shadow
            .as_ref()
            .map(|t| seen(&t.state().root(), scale));
        let focus = (self.a11y.shadow.as_ref()).and_then(|t| {
            t.state()
                .focus()
                .map(|f| json!({ "role": role_name(f.role()), "label": f.label() }))
        });
        Ok(
            json!({ "active": self.a11y.desk.is_active(), "acted": acted, "focus": focus, "tree": tree }),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::action_of;
    use accesskit::Action;

    #[test]
    fn a_check_names_actions_in_kebab_case() {
        assert_eq!(action_of("click"), Some(Action::Click));
        assert_eq!(action_of("set-value"), Some(Action::SetValue));
        assert_eq!(action_of("scroll-down"), Some(Action::ScrollDown));
        assert_eq!(action_of("nonsense"), None);
    }
}
