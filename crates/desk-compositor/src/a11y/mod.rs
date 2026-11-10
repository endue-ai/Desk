//! Accessibility (#57, `specs/surface/v0/accessibility.md`, #32 §2): the desk's one tree for screen
//! readers, in AccessKit's shape, engine free. The root tree is the compositor's own chrome
//! ([`DeskChrome`]: the window list, each window with its title bar, its tools and its panes, the
//! cards it draws with their buttons), which the window manager's host describes after every
//! layout; every surface's tree ([`SurfaceTree`], merged from its `a11y.update`s) is a subtree of
//! its own, grafted where the surface is drawn, its bounds going through that place's transform.
//! [`DeskA11y::flush`] answers the updates that bring the platform adapter's tree to the desk's as
//! it is now, and only updates the adapter accepts, whatever a surface sent;
//! [`DeskA11y::request`] turns what an assistive technology asks for into what the shell does.
//!
//! - `roles`: the wire's kebab-case roles and action names, AccessKit's `Role` and `Action`.
//! - `surface`: one surface's tree, merged and cut to what its root reaches.
//! - `chrome`: the chrome's description and the root tree's nodes, grafts included.
//! - `spread`: the spread's dialog, its combobox over the windows' titles (#54).
//! - `emit`: what the adapter has, and the next valid updates.
//! - `actions`: an assistive technology's request, as protocol messages, wheels and presses.

mod actions;
mod chrome;
mod emit;
mod roles;
mod spread;
mod surface;

use std::collections::{BTreeMap, HashMap};

use accesskit::{NodeId, TreeId, TreeUpdate};
use desk_surface::generated::SurfaceA11yUpdate;

pub use accesskit;
pub use actions::Request;
pub use chrome::{
    Built, ChromeButton, ChromeCard, ChromePane, ChromeWindow, DeskChrome, Does, Graft, PaneShows,
    Placed, Press, tree_of,
};
pub use emit::Wanted;
pub use roles::{action_of, name_of, role_name, role_of};
pub use spread::{ChromeOption, ChromeSpread};
pub use surface::{MAX_NODES, Nodes, SurfaceTree, node_of};

/// The desk's accessibility: the chrome, every surface's tree, and what the adapter has.
#[derive(Debug, Default)]
pub struct DeskA11y {
    active: bool,
    chrome: DeskChrome,
    built: Built,
    ids: chrome::Ids,
    trees: HashMap<String, SurfaceTree>,
    emitter: emit::Emitter,
    /// The chrome changed since the last flush.
    rebuild: bool,
    /// The surfaces with a tree when the root tree was last built, and each tree's generation.
    with_trees: BTreeMap<String, u64>,
    /// Each subtree's revision as it was last sent.
    sent: HashMap<String, u64>,
}

impl DeskA11y {
    pub fn new() -> DeskA11y {
        DeskA11y::default()
    }

    /// Whether an assistive technology is active (the surfaces export their trees).
    pub fn is_active(&self) -> bool {
        self.active
    }

    /// An assistive technology started, or the adapter asks for the whole tree again: the next
    /// flush sends all of it.
    pub fn activate(&mut self) {
        self.active = true;
        self.emitter.reset();
        self.sent.clear();
        self.rebuild = true;
    }

    /// No assistive technology any more: the trees go, the surfaces stop exporting.
    pub fn deactivate(&mut self) {
        *self = DeskA11y {
            chrome: std::mem::take(&mut self.chrome),
            ..DeskA11y::default()
        };
    }

    /// A surface's `a11y.update`.
    pub fn update(&mut self, update: SurfaceA11yUpdate) {
        if self.active {
            let surface = update.surface.clone();
            self.trees.entry(surface).or_default().apply(update);
        }
    }

    /// Surface `surface` is gone (destroyed): its tree with it.
    pub fn forget(&mut self, surface: &str) {
        self.trees.remove(surface);
        self.sent.remove(surface);
    }

    /// Surface `surface` sleeps or died (`true`) or is live again: its last tree stays, marked.
    pub fn set_unavailable(&mut self, surface: &str, unavailable: bool) {
        if let Some(tree) = self.trees.get_mut(surface) {
            tree.set_unavailable(unavailable);
        }
    }

    /// The chrome as it is drawn now.
    pub fn set_chrome(&mut self, chrome: DeskChrome) {
        if chrome != self.chrome {
            self.chrome = chrome;
            self.rebuild = true;
        }
    }

    pub fn chrome(&self) -> &DeskChrome {
        &self.chrome
    }

    pub fn tree(&self, surface: &str) -> Option<&SurfaceTree> {
        self.trees.get(surface)
    }

    /// The root tree as last built.
    pub fn built(&self) -> &Built {
        &self.built
    }

    /// The surface whose subtree `tree` is.
    pub fn surface_of_tree(&self, tree: TreeId) -> Option<String> {
        (self.built.grafts.iter())
            .find(|(_, g)| g.tree == tree)
            .map(|(s, _)| s.clone())
    }

    /// The subtree surface `surface`'s tree is grafted as, while it is.
    pub fn tree_id(&self, surface: &str) -> Option<TreeId> {
        self.built.grafts.get(surface).map(|g| g.tree)
    }

    /// The updates that bring the adapter to the desk as it is now: none while inactive or when
    /// nothing changed.
    pub fn flush(&mut self) -> Vec<TreeUpdate> {
        if !self.active {
            return Vec::new();
        }
        let with_trees: BTreeMap<String, u64> = (self.trees.iter())
            .filter(|(_, t)| t.root().is_some())
            .map(|(s, t)| (s.clone(), t.generation()))
            .collect();
        if with_trees != self.with_trees {
            self.with_trees = with_trees;
            self.rebuild = true;
        }
        let rebuilt = std::mem::take(&mut self.rebuild);
        if rebuilt {
            let tree = |s: &str| self.with_trees.get(s).map(|g| tree_of(s, *g));
            self.built = chrome::build(&self.chrome, &mut self.ids, &tree);
        }
        let changed = |(s, g): (&String, &Graft)| {
            let revision = self.trees.get(s).map(SurfaceTree::revision);
            (!self.emitter.has(g.tree) || self.sent.get(s).copied() != revision).then(|| s.clone())
        };
        let subtrees: Vec<String> = self.built.grafts.iter().filter_map(changed).collect();
        // The focus is the chrome's: it moved only if the chrome did.
        if !rebuilt && subtrees.is_empty() {
            return Vec::new();
        }
        let (focus, fallback) = self.focus();
        let root = Wanted {
            root: self.built.root,
            nodes: self.built.nodes.clone(),
            focus,
        };
        let wanted: Vec<(TreeId, Option<Wanted>)> = (subtrees.iter())
            .map(|s| {
                let nodes = self.trees.get(s).and_then(SurfaceTree::accesskit);
                let want = nodes.map(|n| Wanted {
                    root: n.root,
                    nodes: n.nodes,
                    focus: n.focus,
                });
                (self.built.grafts[s].tree, want)
            })
            .collect();
        let updates = self.emitter.updates(root, wanted, fallback);
        for s in subtrees {
            if self.emitter.has(self.built.grafts[&s].tree)
                && let Some(tree) = self.trees.get(&s)
            {
                self.sent.insert(s, tree.revision());
            }
        }
        updates
    }

    /// The whole tree again (the adapter asks for it).
    pub fn full(&mut self) -> Vec<TreeUpdate> {
        self.activate();
        self.flush()
    }

    /// Where the root tree's focus goes: the focused surface's graft (its tree's focus), and until
    /// that subtree is there, its window, else the root.
    fn focus(&self) -> (NodeId, NodeId) {
        let root = self.built.root;
        if let Some(own) = self.built.focus {
            return (own, own);
        }
        let Some(surface) = &self.chrome.focus else {
            return (root, root);
        };
        match self.built.grafts.get(surface) {
            Some(g) => (g.node, g.window.unwrap_or(root)),
            None => (root, root),
        }
    }
}
