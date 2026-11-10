//! The accessibility run (#57): a surface of the probe's controls page exports its tree once told
//! `a11y.enable`, merged as the compositor merges it (`desk_compositor::a11y::SurfaceTree`); then a
//! screen reader's actions, as the compositor sends them: a click on the button (the page counts
//! it), the focus to the field (the tree's focus follows), a value typed into it, the list's last
//! item scrolled into view (its box moves into the list's); asleep and woken, the new browser
//! exports again; and an export turned off.

use std::time::Duration;

use desk_compositor::a11y::SurfaceTree;
use serde_json::{Value, json};

use super::Probe;
use super::input_gate::presses;

const SIZE: (u32, u32) = (400, 300);
const WAIT: Duration = Duration::from_secs(10);

/// The node of `surface`'s tree with `role` and `name` (a label's words are its value).
fn find(probe: &Probe, surface: &str, role: &str, name: &str) -> Option<u64> {
    let tree = probe.a11y.get(surface)?;
    tree.walk().into_iter().map(|(id, _)| id).find(|id| {
        tree.node(*id).is_some_and(|n| {
            let words = n.name.as_deref().or(n.value.as_deref());
            n.role == role && words == Some(name)
        })
    })
}

fn node(probe: &Probe, surface: &str, id: Option<u64>) -> Value {
    let tree = probe.a11y.get(surface);
    let node = id.and_then(|id| tree?.node(id));
    node.map_or(Value::Null, |n| json!(n))
}

fn act(probe: &Probe, surface: &str, node: u64, action: &str, value: Option<&str>) {
    let mut message =
        json!({ "type": "a11y.action", "surface": surface, "node": node, "action": action });
    if let Some(value) = value {
        message["value"] = json!(value);
    }
    probe.send(message);
}

/// What a screen reader sees of the tree: each node's role and words, in order.
fn outline(tree: Option<&SurfaceTree>) -> Vec<Value> {
    let Some(tree) = tree else { return Vec::new() };
    (tree.walk().into_iter())
        .filter_map(|(id, _)| tree.node(id))
        .filter(|n| n.role != "generic-container")
        .map(|n| json!([n.role, n.name.as_deref().or(n.value.as_deref())]))
        .collect()
}

pub fn a11y(probe: &mut Probe) -> Value {
    let s = "a";
    probe.create(s, "probe.a11y", SIZE);
    let started = probe.pump_until(WAIT, |p| p.pid(s).is_some() && p.paints(s) >= 1);
    let before = probe.a11y_updates;
    probe.pump_for(Duration::from_millis(300));
    let silent = probe.a11y_updates == before;
    probe.send(json!({ "type": "a11y.enable", "surface": s, "enabled": true }));
    let exported = probe.pump_until(WAIT, |p| find(p, s, "button", "Add").is_some());
    let add = find(probe, s, "button", "Add");
    let field = find(probe, s, "text-input", "New item");
    let heading = find(probe, s, "heading", "Shopping");
    let milk = find(probe, s, "check-box", "Milk");
    let tree = probe.a11y.get(s);
    let root = tree.and_then(SurfaceTree::root);
    let found = json!({
        "root": node(probe, s, root), "heading": node(probe, s, heading),
        "field": node(probe, s, field), "add": node(probe, s, add), "milk": node(probe, s, milk),
        "outline": outline(tree), "nodes": tree.map(SurfaceTree::len),
    });
    let Some((add, field)) = add.zip(field) else {
        return json!({ "scenario": "a11y", "started": started, "silent": silent,
            "exported": exported, "found": found });
    };
    act(probe, s, add, "click", None);
    let clicked = probe.pump_until(WAIT, |p| presses(p, s) == Some(1));
    act(probe, s, field, "focus", None);
    let focused = probe.pump_until(WAIT, |p| {
        p.a11y.get(s).and_then(SurfaceTree::focus) == Some(field)
    });
    act(probe, s, field, "set-value", Some("Buy milk"));
    let typed = probe.pump_until(WAIT, |p| {
        let tree = p.a11y.get(s);
        tree.and_then(|t| t.node(field)?.value.clone()).as_deref() == Some("Buy milk")
    });
    let list = find(probe, s, "list", "Items");
    let last = find(probe, s, "label", "Item 20");
    let top_of = |p: &Probe, id: Option<u64>| {
        let tree = p.a11y.get(s)?;
        let b = tree.node(id?)?.bounds.as_ref()?;
        Some((b.y, b.y + b.height))
    };
    let last_before = top_of(probe, last);
    if let Some(last) = last {
        act(probe, s, last, "scroll-into-view", None);
    }
    let list_box = top_of(probe, list);
    let scrolled = probe.pump_until(WAIT, |p| {
        let (Some((top, bottom)), Some((y0, y1))) = (list_box, top_of(p, last)) else {
            return false;
        };
        y0 >= top - 0.5 && y1 <= bottom + 0.5
    });
    let last_after = top_of(probe, last);
    // Asleep and woken: the new browser exports again, a whole new page's tree.
    probe.send(json!({ "type": "sleep", "surface": s }));
    probe.pump_for(Duration::from_millis(500));
    let asleep_at = probe.a11y_updates;
    let size = json!({ "width": SIZE.0, "height": SIZE.1 });
    probe.send(json!({ "type": "wake", "surface": s, "size": size, "scale": 2 }));
    let woke = probe.pump_until(WAIT, |p| {
        let empty = |id| {
            let value = p.a11y.get(s)?.node(id)?.value.clone();
            Some(value.unwrap_or_default().is_empty())
        };
        let field = find(p, s, "text-input", "New item");
        p.a11y_updates > asleep_at && field.and_then(empty) == Some(true)
    });
    let add = find(probe, s, "button", "Add").unwrap_or(add);
    probe.send(json!({ "type": "a11y.enable", "surface": s, "enabled": false }));
    probe.pump_for(Duration::from_millis(200));
    let off_at = probe.a11y_updates;
    let clicks_off = presses(probe, s);
    act(probe, s, add, "click", None);
    probe.pump_for(Duration::from_millis(500));
    json!({
        "scenario": "a11y",
        "started": started,
        "silent": silent,
        "exported": exported,
        "found": found,
        "clicked": clicked,
        "focused": focused,
        "typed": typed,
        "scrolled": scrolled,
        "woke": woke,
        "list": list_box,
        "last": { "before": last_before, "after": last_after },
        "updates": probe.a11y_updates,
        "after_off": probe.a11y_updates - off_at,
        "clicks": { "before": clicks_off, "after": presses(probe, s) },
    })
}
