//! What the compositor draws, as screen readers see it: the desk's own nodes. The window manager's
//! host describes it after every layout ([`DeskChrome`], the window's logical pixels): the page
//! under every window, whose tree is the desk's system layer (its bars, Eris, menus); the window
//! list, each window with its title bar, its title bar's buttons and its panes, a pane showing a
//! surface's tree or a card with its buttons; and the surfaces the page lays out itself above the
//! windows. [`build`] turns it into the root tree's nodes: a surface is a graft node where its tree
//! goes, through the transform of its place on screen.

use std::collections::HashMap;

use accesskit::{Action, Affine, Node, NodeId, Rect as AkRect, Role, TreeId, Uuid};

use crate::types::Rect;

/// Where a surface's tree goes: its logical pixels to the window's, as the compositor draws it.
#[derive(Clone, Debug, PartialEq)]
pub struct Placed {
    pub surface: String,
    /// Row-major 2D affine `[a, b, c, d, e, f]`: `x' = a x + c y + e`, `y' = b x + d y + f`
    /// (AccessKit's order).
    pub transform: [f64; 6],
}

impl Placed {
    /// `surface` drawn with its top left at `(x, y)`, one of its pixels to one of the window's.
    pub fn at(surface: &str, x: f64, y: f64) -> Placed {
        Placed {
            surface: surface.to_owned(),
            transform: [1.0, 0.0, 0.0, 1.0, x, y],
        }
    }
}

/// What pressing a button of the compositor's does.
#[derive(Clone, Debug, PartialEq)]
pub enum Press {
    /// A press at this point of the window, as a person's click.
    At(f32, f32),
    /// The node of a surface's tree it stands for (a title bar's tool the page draws).
    Node { surface: String, node: u64 },
}

#[derive(Clone, Debug, PartialEq)]
pub struct ChromeButton {
    pub label: String,
    pub rect: Rect,
    pub press: Press,
}

/// A card the compositor draws in a pane: asleep, stopped, crashed, not painted yet, not responding.
#[derive(Clone, Debug, PartialEq)]
pub struct ChromeCard {
    pub title: String,
    pub line: String,
    pub rect: Rect,
    pub buttons: Vec<ChromeButton>,
}

/// What a pane shows.
#[derive(Clone, Debug, PartialEq)]
pub enum PaneShows {
    /// A surface's frame: its tree.
    Surface(Placed),
    /// A card instead of a frame.
    Card(ChromeCard),
    /// A card over the surface's last frame (not responding): both.
    Over(Placed, ChromeCard),
    /// A view the page draws itself (its tree is the page's).
    Page,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ChromePane {
    pub id: String,
    pub title: String,
    pub rect: Rect,
    pub shows: PaneShows,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ChromeWindow {
    pub id: String,
    pub title: String,
    pub rect: Rect,
    pub title_bar: Rect,
    pub focused: bool,
    /// Where a click raises it and gives it the keys: its title's text.
    pub raise: (f32, f32),
    /// Its title bar's tools.
    pub buttons: Vec<ChromeButton>,
    pub panes: Vec<ChromePane>,
}

/// The desk's chrome on one OS window, in its logical pixels; `scale` device pixels to one.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DeskChrome {
    pub label: String,
    pub scale: f64,
    pub size: (f32, f32),
    /// The page under every window, and its group's label.
    pub page: Option<(String, Placed)>,
    /// The window list's label, and the windows back to front.
    pub windows_label: String,
    pub windows: Vec<ChromeWindow>,
    /// The surfaces the page lays out over the windows, each with its label.
    pub overlays: Vec<(String, Placed)>,
    /// The surface with the keyboard focus.
    pub focus: Option<String>,
}

/// The subtree of surface `surface` while its tree has root number `generation`: the same id for
/// the same pair, never the root tree's. A root that moves is a new subtree, which AccessKit's
/// consumer (0.39.2) takes whole, where moving a subtree's root in place can drop the new root.
pub fn tree_of(surface: &str, generation: u64) -> TreeId {
    // FNV-1a, 128 bits: stable across runs, no dependency.
    let mut hash: u128 = 0x6c62272e07bb014262b821756295c58d;
    let generation = generation.to_le_bytes();
    let key = (b"desk-surface/".iter())
        .chain(surface.as_bytes())
        .chain(b"/")
        .chain(&generation);
    for byte in key {
        hash ^= u128::from(*byte);
        hash = hash.wrapping_mul(0x0000000001000000000000000000013b);
    }
    TreeId(Uuid::from_u128(hash.max(1)))
}

/// What a node of the root tree does when asked.
#[derive(Clone, Debug, PartialEq)]
pub enum Does {
    Press(Press),
    /// Raise the window and give it the keys: a press at its title.
    Raise {
        at: (f32, f32),
    },
}

/// Where a surface's tree is grafted: the graft node, its subtree and the window node it is in.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Graft {
    pub node: NodeId,
    pub tree: TreeId,
    pub window: Option<NodeId>,
}

/// The root tree's nodes, its grafts and what its nodes do.
#[derive(Clone, Debug, PartialEq)]
pub struct Built {
    pub root: NodeId,
    pub nodes: HashMap<NodeId, Node>,
    /// Every grafted surface.
    pub grafts: HashMap<String, Graft>,
    pub does: HashMap<NodeId, Does>,
}

impl Default for Built {
    fn default() -> Built {
        Built {
            root: NodeId(0),
            nodes: HashMap::new(),
            grafts: HashMap::new(),
            does: HashMap::new(),
        }
    }
}

/// Stable ids for the root tree's nodes, by what they are.
#[derive(Clone, Debug, Default)]
pub struct Ids {
    ids: HashMap<String, u64>,
    next: u64,
    used: Vec<String>,
}

impl Ids {
    fn id(&mut self, key: String) -> NodeId {
        let next = &mut self.next;
        let id = *self.ids.entry(key.clone()).or_insert_with(|| {
            *next += 1;
            *next
        });
        self.used.push(key);
        NodeId(id)
    }

    /// Forget the keys the last build did not use.
    fn settle(&mut self) {
        let used: std::collections::HashSet<String> = self.used.drain(..).collect();
        self.ids.retain(|k, _| used.contains(k));
    }
}

fn bounds(r: Rect) -> AkRect {
    let (x, y) = (f64::from(r.x), f64::from(r.y));
    let (w, h) = (f64::from(r.width.max(0.0)), f64::from(r.height.max(0.0)));
    AkRect::new(x, y, x + w, y + h)
}

struct Builder<'a> {
    ids: &'a mut Ids,
    out: Built,
    /// The subtree of each surface with a tree to graft.
    tree: &'a dyn Fn(&str) -> Option<TreeId>,
}

impl Builder<'_> {
    fn put(&mut self, key: String, node: Node) -> NodeId {
        let id = self.ids.id(key);
        self.out.nodes.insert(id, node);
        id
    }

    fn graft(&mut self, placed: &Placed, window: Option<NodeId>) -> Option<NodeId> {
        if self.out.grafts.contains_key(&placed.surface) {
            return None;
        }
        let tree = (self.tree)(&placed.surface)?;
        let mut node = Node::new(Role::GenericContainer);
        node.set_tree_id(tree);
        node.set_transform(Affine::new(placed.transform));
        let id = self.put(format!("graft/{}", placed.surface), node);
        let graft = Graft {
            node: id,
            tree,
            window,
        };
        self.out.grafts.insert(placed.surface.clone(), graft);
        Some(id)
    }

    fn button(&mut self, key: String, b: &ChromeButton) -> NodeId {
        let mut node = Node::new(Role::Button);
        node.set_label(b.label.as_str());
        node.set_bounds(bounds(b.rect));
        node.add_action(Action::Click);
        let id = self.put(key, node);
        self.out.does.insert(id, Does::Press(b.press.clone()));
        id
    }

    fn card(&mut self, key: &str, card: &ChromeCard) -> NodeId {
        let buttons: Vec<NodeId> = (card.buttons.iter().enumerate())
            .map(|(i, b)| self.button(format!("{key}/card/{i}/{}", b.label), b))
            .collect();
        let mut node = Node::new(Role::Group);
        node.set_label(card.title.as_str());
        if !card.line.is_empty() {
            node.set_description(card.line.as_str());
        }
        node.set_bounds(bounds(card.rect));
        node.set_children(buttons);
        self.put(format!("{key}/card"), node)
    }

    fn shows(&mut self, key: &str, shows: &PaneShows, window: NodeId) -> Vec<NodeId> {
        match shows {
            PaneShows::Surface(placed) => self.graft(placed, Some(window)).into_iter().collect(),
            PaneShows::Card(card) => vec![self.card(key, card)],
            // The card after the surface: a hit test finds it first, as it is drawn over.
            PaneShows::Over(placed, card) => {
                let mut all: Vec<NodeId> = self.graft(placed, Some(window)).into_iter().collect();
                all.push(self.card(key, card));
                all
            }
            PaneShows::Page => Vec::new(),
        }
    }

    fn window(&mut self, w: &ChromeWindow) -> NodeId {
        let key = format!("window/{}", w.id);
        let window = self.ids.id(key.clone());
        let mut bar = Node::new(Role::TitleBar);
        bar.set_label(w.title.as_str());
        bar.set_bounds(bounds(w.title_bar));
        bar.add_action(Action::Click);
        let bar = self.put(format!("{key}/title"), bar);
        let raise = Does::Raise { at: w.raise };
        self.out.does.insert(bar, raise.clone());
        let mut children = vec![bar];
        for (i, b) in w.buttons.iter().enumerate() {
            children.push(self.button(format!("{key}/tool/{i}/{}", b.label), b));
        }
        if let [pane] = w.panes.as_slice() {
            // One pane: what it shows is the window's own content.
            children.extend(self.shows(&format!("{key}/pane/{}", pane.id), &pane.shows, window));
        } else {
            for pane in &w.panes {
                let pane_key = format!("{key}/pane/{}", pane.id);
                let inside = self.shows(&pane_key, &pane.shows, window);
                let mut node = Node::new(Role::Group);
                node.set_label(pane.title.as_str());
                node.set_bounds(bounds(pane.rect));
                node.set_children(inside);
                children.push(self.put(pane_key, node));
            }
        }
        let mut node = Node::new(Role::Window);
        node.set_label(w.title.as_str());
        node.set_bounds(bounds(w.rect));
        node.set_selected(w.focused);
        node.add_action(Action::Click);
        node.add_action(Action::Focus);
        node.set_children(children);
        self.out.nodes.insert(window, node);
        self.out.does.insert(window, raise);
        window
    }
}

/// The root tree for `chrome`; `tree` names the subtree of each surface with a tree to graft.
pub fn build(chrome: &DeskChrome, ids: &mut Ids, tree: &dyn Fn(&str) -> Option<TreeId>) -> Built {
    let mut b = Builder {
        ids,
        out: Built::default(),
        tree,
    };
    let mut top = Vec::new();
    if let Some((label, placed)) = &chrome.page
        && let Some(graft) = b.graft(placed, None)
    {
        let mut group = Node::new(Role::Group);
        group.set_label(label.as_str());
        group.set_children(vec![graft]);
        top.push(b.put("page".into(), group));
    }
    if !chrome.windows.is_empty() {
        let windows: Vec<NodeId> = chrome.windows.iter().map(|w| b.window(w)).collect();
        let mut list = Node::new(Role::List);
        list.set_label(chrome.windows_label.as_str());
        list.set_children(windows);
        top.push(b.put("windows".into(), list));
    }
    for (label, placed) in &chrome.overlays {
        if let Some(graft) = b.graft(placed, None) {
            let mut group = Node::new(Role::Group);
            group.set_label(label.as_str());
            group.set_children(vec![graft]);
            top.push(b.put(format!("overlay/{}", placed.surface), group));
        }
    }
    let mut root = Node::new(Role::Window);
    root.set_label(chrome.label.as_str());
    root.set_transform(Affine::scale(chrome.scale.max(0.01)));
    root.set_bounds(bounds(Rect::new(0.0, 0.0, chrome.size.0, chrome.size.1)));
    root.set_children(top);
    let root = b.put("root".into(), root);
    let mut out = b.out;
    out.root = root;
    ids.settle();
    out
}
