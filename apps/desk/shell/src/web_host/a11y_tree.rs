//! A surface's mirror of Chromium's accessibility trees (one per frame: the page's document and
//! each iframe's), kept from CEF's events: `OnAccessibilityTreeChange` (`{ ax_tree_id, updates:
//! [{ tree_data?, node_id_to_clear?, root_id?, nodes }], events }`, Chromium's `AXTreeUpdate`s) and
//! `OnAccessibilityLocationChange` (`[{ ax_tree_id, id, new_location }]`). It answers the protocol's
//! `a11y.update` with what changed since the last one: the trees stitched into one at their iframes,
//! every node's box worked out in the surface's logical pixels (each box is relative to its offset
//! container, less the container's scroll, through any transform; a child tree sits at its iframe;
//! Chromium's boxes are the view's device pixels, so the device scale divides them),
//! the focus of the frame that has it, and ids of the protocol's own (unique in the surface, stable
//! while a node lives).

use std::collections::{HashMap, HashSet};

use desk_surface::generated::{SurfaceA11yNode, SurfaceA11yTree, SurfaceA11yUpdate};
use serde_json::Value;

use super::nodes::{AxNode, rect_of, transform_of};

/// The most nodes a surface exports (the schema's `maxItems`).
const MAX_NODES: usize = 100_000;
/// The most children a node lists.
const MAX_CHILDREN: usize = 10_000;

/// One frame's tree.
#[derive(Clone, Debug, Default)]
pub struct AxTree {
    pub root: Option<i64>,
    pub nodes: HashMap<i64, AxNode>,
    pub focus: Option<i64>,
    pub parent: Option<String>,
}

impl AxTree {
    /// Every node `from` reaches, `from` included.
    fn under(&self, from: i64) -> Vec<i64> {
        let mut seen = HashSet::from([from]);
        let mut stack = vec![from];
        while let Some(id) = stack.pop() {
            for &child in self
                .nodes
                .get(&id)
                .map(|n| n.children.as_slice())
                .unwrap_or_default()
            {
                if seen.insert(child) {
                    stack.push(child);
                }
            }
        }
        seen.into_iter().collect()
    }

    /// Node `id`'s box relative to the tree's root, as Chromium's `AXTree::RelativeToTreeBounds`
    /// works it out (without clipping).
    pub fn bounds(&self, id: i64) -> Option<[f64; 4]> {
        let node = self.nodes.get(&id)?;
        let [mut x, mut y, mut w, mut h] = node.bounds;
        let mut at = id;
        for _ in 0..64 {
            let node = self.nodes.get(&at)?;
            if let Some([a, b, c, d, e, f]) = node.transform {
                let (x0, y0) = (a * x + c * y + e, b * x + d * y + f);
                let (x1, y1) = (a * (x + w) + c * (y + h) + e, b * (x + w) + d * (y + h) + f);
                (x, y, w, h) = (x0.min(x1), y0.min(y1), (x1 - x0).abs(), (y1 - y0).abs());
            }
            let container = node.offset_container.filter(|c| self.nodes.contains_key(c));
            let Some(container) = container.or(self.root).filter(|c| *c != at) else {
                break;
            };
            let up = &self.nodes[&container];
            x += up.bounds[0] - up.int("scrollX").unwrap_or(0) as f64;
            y += up.bounds[1] - up.int("scrollY").unwrap_or(0) as f64;
            at = container;
        }
        Some([x, y, w, h])
    }
}

/// Every frame's tree of one surface, and what the compositor was told.
#[derive(Clone, Debug, Default)]
pub struct WebTree {
    pub trees: HashMap<String, AxTree>,
    /// The page's own document's tree.
    main: Option<String>,
    /// The tree whose focus is the page's.
    focused: Option<String>,
    ids: HashMap<(String, i64), u64>,
    back: HashMap<u64, (String, i64)>,
    next: u64,
    sent: HashMap<u64, SurfaceA11yNode>,
    sent_root: Option<u64>,
    sent_focus: Option<u64>,
}

impl WebTree {
    /// An `OnAccessibilityTreeChange`.
    pub fn events(&mut self, json: &Value) {
        let tree_id = json
            .get("ax_tree_id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        for update in json
            .get("updates")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            self.apply(tree_id, update);
        }
        // A focus event names the focused node of its tree.
        for event in json
            .get("events")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let focus = event.get("event_type").and_then(Value::as_str) == Some("focus");
            if let (true, Some(id)) = (focus, event.get("id").and_then(Value::as_i64))
                && let Some(tree) = self.trees.get_mut(tree_id)
            {
                tree.focus = Some(id);
                self.focused = Some(tree_id.to_owned());
            }
        }
    }

    fn apply(&mut self, tree_id: &str, update: &Value) {
        let data = update.get("tree_data");
        let id = (data.and_then(|d| d.get("tree_id")).and_then(Value::as_str)).unwrap_or(tree_id);
        let tree = self.trees.entry(id.to_owned()).or_default();
        if let Some(clear) = update.get("node_id_to_clear").and_then(Value::as_i64) {
            for gone in tree.under(clear).into_iter().filter(|n| *n != clear) {
                tree.nodes.remove(&gone);
            }
        }
        for node in update
            .get("nodes")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some((node_id, node)) = AxNode::parse(node) {
                tree.nodes.insert(node_id, node);
            }
        }
        if let Some(root) = update.get("root_id").and_then(Value::as_i64) {
            tree.root = Some(root);
        }
        if let Some(data) = data {
            tree.focus = data
                .get("focus_id")
                .and_then(Value::as_i64)
                .filter(|f| *f != -1);
            let parent = data.get("parent_tree_id").and_then(Value::as_str);
            tree.parent = parent.filter(|p| !p.is_empty()).map(str::to_owned);
            if tree.parent.is_none() {
                // The page's document: a navigation brings a new one, and only its frames stay.
                if self
                    .main
                    .replace(id.to_owned())
                    .is_some_and(|old| old != id)
                {
                    self.trees
                        .retain(|t, tree| t == id || tree.parent.as_deref() == Some(id));
                }
                let focused = data.get("focused_tree_id").and_then(Value::as_str);
                self.focused = focused.filter(|f| !f.is_empty()).map(str::to_owned);
            }
        }
        if let Some(tree) = self.trees.get_mut(id)
            && let Some(root) = tree.root
        {
            let reached: HashSet<i64> = tree.under(root).into_iter().collect();
            tree.nodes.retain(|n, _| reached.contains(n));
        }
        if self.main.is_none() && self.trees.get(id).is_some_and(|t| t.parent.is_none()) {
            self.main = Some(id.to_owned());
        }
    }

    /// An `OnAccessibilityLocationChange`: new boxes (and scroll offsets) for some nodes.
    pub fn locations(&mut self, json: &Value) {
        let all = match json {
            Value::Array(all) => all.clone(),
            Value::Object(o) => o
                .values()
                .filter_map(Value::as_array)
                .flatten()
                .cloned()
                .collect(),
            _ => Vec::new(),
        };
        let one = if json.get("id").is_some() {
            vec![json.clone()]
        } else {
            all
        };
        for change in one {
            let tree = change
                .get("ax_tree_id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let (Some(tree), Some(id)) = (
                self.trees.get_mut(tree),
                change.get("id").and_then(Value::as_i64),
            ) else {
                continue;
            };
            let Some(node) = tree.nodes.get_mut(&id) else {
                continue;
            };
            if let Some(at) = change.get("new_location") {
                if let Some(bounds) = rect_of(at.get("bounds").unwrap_or(at)) {
                    node.bounds = bounds;
                }
                node.offset_container = at
                    .get("offset_container_id")
                    .and_then(Value::as_i64)
                    .filter(|c| *c != -1);
                node.transform = at
                    .get("transform")
                    .and_then(Value::as_str)
                    .and_then(transform_of);
            }
            for (key, attr) in [("scroll_x", "scrollX"), ("scroll_y", "scrollY")] {
                if let Some(v) = change.get(key).filter(|v| v.is_number()) {
                    node.attributes.insert(attr.into(), v.clone());
                }
            }
        }
    }

    fn id_of(&mut self, tree: &str, node: i64) -> u64 {
        let key = (tree.to_owned(), node);
        if let Some(id) = self.ids.get(&key) {
            return *id;
        }
        self.next += 1;
        self.ids.insert(key.clone(), self.next);
        self.back.insert(self.next, key);
        self.next
    }

    /// The scrollable nodes of the page's own document (Blink's ids).
    pub fn scrollers(&self) -> Vec<i64> {
        let Some(tree) = self.main.as_ref().and_then(|m| self.trees.get(m)) else {
            return Vec::new();
        };
        let scrollable =
            |n: &AxNode| n.attributes.get("scrollable").and_then(Value::as_bool) == Some(true);
        tree.nodes
            .iter()
            .filter(|(_, n)| scrollable(n))
            .map(|(id, _)| *id)
            .collect()
    }

    /// Node `ax` of the page's own document is scrolled to `(x, y)` (device pixels).
    pub fn scrolled(&mut self, ax: i64, x: i64, y: i64) {
        let tree = self.main.as_ref().and_then(|m| self.trees.get_mut(m));
        if let Some(node) = tree.and_then(|t| t.nodes.get_mut(&ax)) {
            node.attributes.insert("scrollX".into(), x.into());
            node.attributes.insert("scrollY".into(), y.into());
        }
    }

    /// Blink's id of the node protocol id `id` stands for, and whether it is in the page's own
    /// document (DevTools names its nodes).
    pub fn locate(&self, id: u64) -> Option<(i64, bool)> {
        let (tree, node) = self.back.get(&id)?;
        Some((*node, self.main.as_ref() == Some(tree)))
    }

    /// The Chromium node protocol id `id` stands for, and its box in the surface.
    pub fn node(&self, id: u64) -> Option<(&AxNode, Option<[f64; 4]>)> {
        let (tree, node) = self.back.get(&id)?;
        let sent = self.sent.get(&id).and_then(|n| n.bounds.as_ref());
        let node = self.trees.get(tree)?.nodes.get(node)?;
        Some((node, sent.map(|b| [b.x, b.y, b.width, b.height])))
    }

    /// The protocol's focused node, as last sent.
    pub fn focus(&self) -> Option<u64> {
        self.sent_focus
    }

    /// The `a11y.update` for what changed since the last, its boxes at device scale `scale`;
    /// `None` when nothing did or there is no document yet.
    pub fn update(&mut self, surface: &str, scale: f64) -> Option<SurfaceA11yUpdate> {
        let scale = if scale.is_finite() && scale > 0.0 {
            scale
        } else {
            1.0
        };
        let main = self.main.clone()?;
        let main_root = self.trees.get(&main)?.root?;
        // Every node, the page's document first, each child tree at its iframe; a node is the
        // child of the first parent that lists it.
        let mut out: HashMap<u64, SurfaceA11yNode> = HashMap::new();
        let mut stack = vec![(main.clone(), main_root, [0.0, 0.0])];
        let mut claimed = HashSet::from([(main.clone(), main_root)]);
        while let Some((tree_id, ax, origin)) = stack.pop() {
            if out.len() >= MAX_NODES {
                break;
            }
            let Some(tree) = self.trees.get(&tree_id) else {
                continue;
            };
            let Some(node) = tree.nodes.get(&ax) else {
                continue;
            };
            let bounds = tree
                .bounds(ax)
                .map(|[x, y, w, h]| [x + origin[0], y + origin[1], w, h]);
            let mut children: Vec<(String, i64, [f64; 2])> = (node.children.iter())
                .filter(|c| tree.nodes.get(c).is_some_and(|n| !n.is_text_run()))
                .map(|c| (tree_id.clone(), *c, origin))
                .collect();
            if let Some(child) = node.child_tree()
                && let Some(root) = self.trees.get(child).and_then(|t| t.root)
            {
                children.push((
                    child.to_owned(),
                    root,
                    bounds.map_or(origin, |b| [b[0], b[1]]),
                ));
            }
            let node = node.clone();
            children.retain(|(t, c, _)| claimed.insert((t.clone(), *c)));
            children.truncate(MAX_CHILDREN);
            let ids: Vec<u64> = children.iter().map(|(t, c, _)| self.id_of(t, *c)).collect();
            let id = self.id_of(&tree_id, ax);
            let logical = bounds.map(|b| b.map(|v| (v / scale * 100.0).round() / 100.0));
            out.insert(id, node.protocol(id, ids, logical));
            stack.extend(children.into_iter().rev());
        }
        let trees_in: HashSet<String> = claimed.into_iter().map(|(t, _)| t).collect();
        let root = self.id_of(&main, main_root);
        let focused = self
            .focused
            .clone()
            .filter(|t| trees_in.contains(t))
            .unwrap_or(main);
        let focus = (self.trees.get(&focused).and_then(|t| t.focus))
            .and_then(|f| self.ids.get(&(focused.clone(), f)).copied())
            .filter(|f| out.contains_key(f))
            .unwrap_or(root);
        // Forget the ids of nodes that are gone.
        self.ids.retain(|_, id| out.contains_key(id));
        self.back.retain(|id, _| out.contains_key(id));
        let moved = self.sent_root != Some(root);
        let changed: Vec<SurfaceA11yNode> = (out.iter())
            .filter(|(id, n)| moved || self.sent.get(id) != Some(n))
            .map(|(_, n)| n.clone())
            .collect();
        if changed.is_empty() && self.sent_focus == Some(focus) {
            return None;
        }
        self.sent = out;
        self.sent_root = Some(root);
        self.sent_focus = Some(focus);
        Some(SurfaceA11yUpdate {
            r#type: Default::default(),
            surface: surface.to_owned(),
            tree: moved.then_some(SurfaceA11yTree { root }),
            nodes: changed,
            focus,
        })
    }
}

#[cfg(test)]
#[path = "a11y_tree_tests.rs"]
mod tests;
