//! One surface's accessibility tree as the compositor keeps it (`accessibility.md` § Tree updates):
//! every `a11y.update` merged in (each node whole, nodes left out as they were, a node no longer
//! reachable from the root gone), and the tree as AccessKit nodes. A surface's process is not
//! trusted to send a well-formed tree, and AccessKit's adapters panic on an ill-formed one, so what
//! goes out is only what the root reaches, each node once, with children that exist.

use std::collections::{HashMap, HashSet};

use accesskit::{Node, NodeId, Rect, Toggled};
use desk_surface::generated::{SurfaceA11yNode, SurfaceA11yToggled, SurfaceA11yUpdate};

use super::roles::{action_of, role_of};

/// The most nodes a surface's tree holds (the schema's `maxItems`); deeper or later ones are cut.
pub const MAX_NODES: usize = 100_000;

/// A surface's tree: its root, its nodes and its focus.
#[derive(Clone, Debug, Default)]
pub struct SurfaceTree {
    root: Option<u64>,
    nodes: HashMap<u64, SurfaceA11yNode>,
    focus: u64,
    unavailable: bool,
    /// Counts the changes: whoever builds on the tree looks again when it moved.
    revision: u64,
    /// Counts the roots: a tree whose root moved is a new subtree for the adapter.
    generation: u64,
}

/// A tree as AccessKit nodes, each reachable from `root` once.
#[derive(Clone, Debug, PartialEq)]
pub struct Nodes {
    pub root: NodeId,
    pub nodes: HashMap<NodeId, Node>,
    pub focus: NodeId,
}

impl SurfaceTree {
    /// Merge `update` in.
    pub fn apply(&mut self, update: SurfaceA11yUpdate) {
        if let Some(tree) = update.tree
            && self.root != Some(tree.root)
        {
            self.root = Some(tree.root);
            self.generation += 1;
        }
        for node in update.nodes {
            self.nodes.insert(node.id, node);
        }
        self.focus = update.focus;
        let reached: HashSet<u64> = self.walk().into_iter().map(|(id, _)| id).collect();
        self.nodes.retain(|id, _| reached.contains(id));
        self.revision += 1;
    }

    /// A sleeping or dead surface's last tree stays, marked unavailable.
    pub fn set_unavailable(&mut self, unavailable: bool) {
        if self.unavailable != unavailable {
            self.unavailable = unavailable;
            self.revision += 1;
        }
    }

    pub fn unavailable(&self) -> bool {
        self.unavailable
    }

    pub fn root(&self) -> Option<u64> {
        self.root.filter(|r| self.nodes.contains_key(r))
    }

    pub fn node(&self, id: u64) -> Option<&SurfaceA11yNode> {
        self.nodes.get(&id)
    }

    /// The focused node: the root when the one named is not in the tree.
    pub fn focus(&self) -> Option<u64> {
        let root = self.root()?;
        Some(if self.nodes.contains_key(&self.focus) {
            self.focus
        } else {
            root
        })
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// Which root the tree has: a new one each time its root moves.
    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// Every node the root reaches, in order, with the children kept: those that exist and were not
    /// reached before (a node has one parent; a cycle ends where it closes).
    pub fn walk(&self) -> Vec<(u64, Vec<u64>)> {
        let Some(root) = self.root() else {
            return Vec::new();
        };
        let mut seen = HashSet::from([root]);
        let mut out = Vec::new();
        let mut stack = vec![root];
        while let Some(id) = stack.pop() {
            let Some(node) = self.nodes.get(&id) else {
                continue;
            };
            let mut kept = Vec::new();
            for &child in node.children.as_deref().unwrap_or_default() {
                if seen.len() >= MAX_NODES {
                    break;
                }
                if self.nodes.contains_key(&child) && seen.insert(child) {
                    kept.push(child);
                }
            }
            stack.extend(kept.iter().rev());
            out.push((id, kept));
        }
        out
    }

    /// The tree as AccessKit nodes; `None` before its first update.
    pub fn accesskit(&self) -> Option<Nodes> {
        let root = self.root()?;
        let mut nodes = HashMap::new();
        for (id, children) in self.walk() {
            let mut node = node_of(&self.nodes[&id], &children);
            if id == root && self.unavailable {
                node.set_disabled();
            }
            nodes.insert(NodeId(id), node);
        }
        let focus = NodeId(self.focus().unwrap_or(root));
        Some(Nodes {
            root: NodeId(root),
            nodes,
            focus,
        })
    }
}

/// A surface's node as AccessKit's, with `children`.
pub fn node_of(n: &SurfaceA11yNode, children: &[u64]) -> Node {
    let mut node = Node::new(role_of(&n.role));
    if let Some(name) = &n.name {
        node.set_label(name.as_str());
    }
    if let Some(text) = &n.description {
        node.set_description(text.as_str());
    }
    if let Some(value) = &n.value {
        node.set_value(value.as_str());
    }
    if let Some(text) = &n.placeholder {
        node.set_placeholder(text.as_str());
    }
    if let Some(url) = &n.url {
        node.set_url(url.as_str());
    }
    if let Some(b) = &n.bounds
        && [b.x, b.y, b.width, b.height].iter().all(|v| v.is_finite())
    {
        let (w, h) = (b.width.max(0.0), b.height.max(0.0));
        node.set_bounds(Rect::new(b.x, b.y, b.x + w, b.y + h));
    }
    if !children.is_empty() {
        node.set_children(children.iter().copied().map(NodeId).collect::<Vec<_>>());
    }
    for &action in n.actions.as_deref().unwrap_or_default() {
        node.add_action(action_of(action));
    }
    if let Some(toggled) = n.toggled {
        node.set_toggled(match toggled {
            SurfaceA11yToggled::True => Toggled::True,
            SurfaceA11yToggled::False => Toggled::False,
            SurfaceA11yToggled::Mixed => Toggled::Mixed,
        });
    }
    if let Some(expanded) = n.expanded {
        node.set_expanded(expanded);
    }
    if let Some(selected) = n.selected {
        node.set_selected(selected);
    }
    if n.disabled == Some(true) {
        node.set_disabled();
    }
    if let Some(level) = n.level {
        node.set_level(level.clamp(1, 255) as usize);
    }
    let finite = |v: Option<f64>| v.filter(|v| v.is_finite());
    if let Some(v) = finite(n.numeric_value) {
        node.set_numeric_value(v);
    }
    if let Some(v) = finite(n.min_numeric_value) {
        node.set_min_numeric_value(v);
    }
    if let Some(v) = finite(n.max_numeric_value) {
        node.set_max_numeric_value(v);
    }
    node
}

#[cfg(test)]
#[path = "surface_tests.rs"]
mod tests;
