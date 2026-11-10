//! What the platform adapter was given, tree by tree, and the next updates from it: each node that
//! is new or changed whole, the tree's root when it moved, its focus every time (AccessKit's rules
//! for a `TreeUpdate`). Only trees that are wholly reachable go out, so every update is one the
//! adapter accepts: the root tree first (its grafts), then each grafted subtree (a new one whole,
//! with its tree info), then the root tree's focus once the subtree it points into is there.

use std::collections::HashMap;

use accesskit::{Node, NodeId, TreeId, TreeInfo, TreeUpdate};

/// One tree as wanted now: its root, every node it reaches and its focus.
#[derive(Clone, Debug, PartialEq)]
pub struct Wanted {
    pub root: NodeId,
    pub nodes: HashMap<NodeId, Node>,
    pub focus: NodeId,
}

/// One tree as the adapter has it.
#[derive(Clone, Debug, Default)]
struct Sent {
    root: Option<NodeId>,
    nodes: HashMap<NodeId, Node>,
    focus: Option<NodeId>,
}

impl Sent {
    /// The update from what was sent to `want`, if anything changed.
    fn update(&mut self, tree_id: TreeId, want: Wanted, toolkit: bool) -> Option<TreeUpdate> {
        let moved = self.root != Some(want.root);
        let nodes: Vec<(NodeId, Node)> = (want.nodes.iter())
            .filter(|(id, node)| self.nodes.get(id) != Some(node))
            .map(|(id, node)| (*id, node.clone()))
            .collect();
        if nodes.is_empty() && !moved && self.focus == Some(want.focus) {
            return None;
        }
        // A subtree whose root node changes says its tree info again: AccessKit's consumer
        // (0.39.2) unlinks an updated subtree root from its graft, and links it back only then.
        let relink = tree_id != TreeId::ROOT && nodes.iter().any(|(id, _)| *id == want.root);
        let tree = (moved || relink).then(|| TreeInfo {
            root: want.root,
            toolkit_name: toolkit.then(|| "endue Desk".to_owned()),
            toolkit_version: None,
        });
        let update = TreeUpdate {
            nodes,
            tree,
            tree_id,
            focus: want.focus,
        };
        *self = Sent {
            root: Some(want.root),
            nodes: want.nodes,
            focus: Some(want.focus),
        };
        Some(update)
    }

    /// The same tree with the focus on `focus`, if it moved.
    fn focus(&mut self, tree_id: TreeId, focus: NodeId) -> Option<TreeUpdate> {
        if self.focus == Some(focus) || !self.nodes.contains_key(&focus) {
            return None;
        }
        self.focus = Some(focus);
        Some(TreeUpdate {
            nodes: Vec::new(),
            tree: None,
            tree_id,
            focus,
        })
    }

    fn grafts(&self) -> HashMap<TreeId, NodeId> {
        (self.nodes.iter())
            .filter_map(|(id, node)| Some((node.tree_id()?, *id)))
            .collect()
    }
}

/// The trees the adapter has.
#[derive(Clone, Debug, Default)]
pub struct Emitter {
    root: Sent,
    subtrees: HashMap<TreeId, Sent>,
}

impl Emitter {
    /// The adapter has nothing (it starts, or asks for the whole tree again).
    pub fn reset(&mut self) {
        *self = Emitter::default();
    }

    /// Whether subtree `tree` is in the adapter's tree.
    pub fn has(&self, tree: TreeId) -> bool {
        self.subtrees.contains_key(&tree)
    }

    /// The updates that bring the adapter to `root` and `subtrees`; `focus` is where the root
    /// tree's focus goes once its subtree is there (a graft node), `fallback` until then.
    pub fn updates(
        &mut self,
        mut root: Wanted,
        subtrees: impl IntoIterator<Item = (TreeId, Option<Wanted>)>,
        fallback: NodeId,
    ) -> Vec<TreeUpdate> {
        let mut out = Vec::new();
        let focus = root.focus;
        let grafted: HashMap<TreeId, NodeId> = (root.nodes.iter())
            .filter_map(|(id, node)| Some((node.tree_id()?, *id)))
            .collect();
        // A graft node takes the focus only once its subtree is in the adapter's tree.
        let into = (root.nodes.get(&focus)).and_then(Node::tree_id);
        let pending = |emitter: &Emitter| into.is_some_and(|tree| !emitter.has(tree));
        if pending(self) {
            root.focus = fallback;
        }
        let first = root.focus;
        let before = self.root.grafts();
        if let Some(update) = self.root.update(TreeId::ROOT, root, true) {
            out.push(update);
        }
        // A graft that went took its subtree with it.
        for tree in before.keys() {
            if !grafted.contains_key(tree) {
                self.subtrees.remove(tree);
            }
        }
        for (tree, want) in subtrees {
            if !grafted.contains_key(&tree) {
                continue;
            }
            let Some(want) = want else {
                continue;
            };
            let sent = self.subtrees.entry(tree).or_default();
            if let Some(update) = sent.update(tree, want, false) {
                out.push(update);
            }
        }
        if first != focus
            && !pending(self)
            && let Some(update) = self.root.focus(TreeId::ROOT, focus)
        {
            out.push(update);
        }
        out
    }
}
