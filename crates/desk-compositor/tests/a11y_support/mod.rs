//! What the accessibility tests share: a platform adapter's view of the desk's tree (AccessKit's
//! consumer, which every adapter builds on and which panics on an update it cannot take), a walk of
//! what a screen reader sees in it, and the desk a test describes.
#![allow(dead_code)]

use accesskit::{NodeId, Role, TreeUpdate};
use accesskit_consumer::{NodeRef, Tree, TreeChangeHandler, common_filter};
use desk_compositor::Rect;
use desk_compositor::a11y::{
    ChromeButton, ChromeCard, ChromePane, ChromeWindow, DeskChrome, PaneShows, Placed, Press,
};
use desk_surface::generated::{SurfaceA11yUpdate, SurfaceMessage};
use serde_json::Value;

struct Quiet;

impl TreeChangeHandler for Quiet {
    fn node_added(&mut self, _: &NodeRef) {}
    fn node_updated(&mut self, _: &NodeRef, _: &NodeRef) {}
    fn focus_moved(&mut self, _: Option<&NodeRef>, _: Option<&NodeRef>) {}
    fn node_removed(&mut self, _: &NodeRef) {}
}

/// The tree as an adapter holds it, fed every update the desk flushes.
#[derive(Default)]
pub struct Adapter {
    pub tree: Option<Tree>,
    pub updates: usize,
}

impl Adapter {
    pub fn apply(&mut self, updates: Vec<TreeUpdate>) {
        for update in updates {
            self.updates += 1;
            match &mut self.tree {
                Some(tree) => tree.update_and_process_changes(update, &mut Quiet),
                None => self.tree = Some(Tree::new(update, true)),
            }
        }
    }

    /// What a screen reader sees, from the root down.
    pub fn seen(&self) -> Seen {
        let tree = self.tree.as_ref().expect("a tree");
        seen(&tree.state().root(), 1.0)
    }

    /// The focused node, as a screen reader hears it.
    pub fn focus(&self) -> Option<Seen> {
        let tree = self.tree.as_ref()?;
        tree.state().focus().map(|n| seen(&n, 1.0))
    }

    /// The first node a screen reader sees with `role` and `label`, and where it is.
    pub fn find(&self, role: Role, label: &str) -> Option<(NodeId, accesskit::TreeId, Seen)> {
        let tree = self.tree.as_ref()?;
        let mut stack = vec![tree.state().root()];
        while let Some(node) = stack.pop() {
            if node.role() == role && node.label().as_deref() == Some(label) {
                let (id, tree) = node.locate();
                return Some((id, tree, seen(&node, 1.0)));
            }
            stack.extend(node.filtered_children(common_filter));
        }
        None
    }
}

/// One node a screen reader sees: its role, its words, its box in the window's device pixels and
/// what it holds.
#[derive(Clone, Debug, PartialEq)]
pub struct Seen {
    pub role: Role,
    pub label: Option<String>,
    pub value: Option<String>,
    pub bounds: Option<[f64; 4]>,
    pub children: Vec<Seen>,
}

impl Seen {
    /// The labels of the children, in order.
    pub fn labels(&self) -> Vec<String> {
        (self.children.iter())
            .map(|c| c.label.clone().unwrap_or_default())
            .collect()
    }

    pub fn roles(&self) -> Vec<Role> {
        self.children.iter().map(|c| c.role).collect()
    }

    /// Every node under this one, this one first.
    pub fn count(&self) -> usize {
        1 + self.children.iter().map(Seen::count).sum::<usize>()
    }
}

fn seen(node: &NodeRef, _scale: f64) -> Seen {
    let bounds = node.bounding_box().map(|r| {
        let round = |v: f64| (v * 100.0).round() / 100.0;
        [
            round(r.x0),
            round(r.y0),
            round(r.x1 - r.x0),
            round(r.y1 - r.y0),
        ]
    });
    Seen {
        role: node.role(),
        label: node.label(),
        value: node.value(),
        bounds,
        children: (node.filtered_children(common_filter))
            .map(|c| seen(&c, 1.0))
            .collect(),
    }
}

/// A surface's `a11y.update` from JSON (`specs/surface/v0/vectors` shape).
pub fn update(json: Value) -> SurfaceA11yUpdate {
    match serde_json::from_value(json).expect("a surface message") {
        SurfaceMessage::SurfaceA11yUpdate(u) => u,
        other => panic!("not an a11y.update: {other:?}"),
    }
}

/// The spec's first-tree vector, for surface `surface`.
pub fn notes(surface: &str) -> SurfaceA11yUpdate {
    let text = include_str!("../../../../specs/surface/v0/vectors/valid/a11y-update-first.json");
    let vector: Value = serde_json::from_str(text).expect("the vector");
    let mut instance = vector["instance"].clone();
    instance["surface"] = Value::String(surface.to_owned());
    update(instance)
}

/// A page tree: its root and one button at `at`.
pub fn page(button: &str, at: [f64; 4]) -> SurfaceA11yUpdate {
    update(serde_json::json!({
        "type": "a11y.update", "surface": "desk", "tree": { "root": 1 },
        "nodes": [
            { "id": 1, "role": "root-web-area", "name": "endue Desk", "children": [2],
              "bounds": { "x": 0, "y": 0, "width": 1280, "height": 800 } },
            { "id": 2, "role": "button", "name": button, "actions": ["click", "focus"],
              "bounds": { "x": at[0], "y": at[1], "width": at[2], "height": at[3] } }
        ],
        "focus": 1
    }))
}

pub fn rect(x: f32, y: f32, w: f32, h: f32) -> Rect {
    Rect::new(x, y, w, h)
}

/// A window at `at` (800 × 600 under a 40 px title bar) showing `shows` in one pane.
pub fn window(id: &str, title: &str, at: (f32, f32), shows: PaneShows) -> ChromeWindow {
    ChromeWindow {
        id: id.into(),
        title: title.into(),
        rect: rect(at.0, at.1, 800.0, 640.0),
        title_bar: rect(at.0, at.1, 800.0, 40.0),
        focused: false,
        raise: (at.0 + 400.0, at.1 + 20.0),
        buttons: Vec::new(),
        panes: vec![ChromePane {
            id: "p1".into(),
            title: title.into(),
            rect: rect(at.0 + 1.0, at.1 + 40.0, 798.0, 599.0),
            shows,
        }],
    }
}

/// A surface drawn with its top left at `(x, y)`.
pub fn surface_at(surface: &str, x: f64, y: f64) -> PaneShows {
    PaneShows::Surface(Placed::at(surface, x, y))
}

/// An asleep card with a Reload button at `(x, y)`.
pub fn asleep(x: f32, y: f32) -> PaneShows {
    PaneShows::Card(ChromeCard {
        title: "Git".into(),
        line: "Asleep".into(),
        rect: rect(x, y, 798.0, 599.0),
        buttons: vec![ChromeButton {
            label: "Reload".into(),
            rect: rect(x + 360.0, y + 330.0, 80.0, 32.0),
            press: Press::At(x + 400.0, y + 346.0),
        }],
    })
}

/// The desk at scale 2 with the page and `windows`, the keys with `focus`.
pub fn desk(windows: Vec<ChromeWindow>, focus: Option<&str>) -> DeskChrome {
    DeskChrome {
        label: "endue Desk".into(),
        scale: 2.0,
        size: (1280.0, 800.0),
        page: Some(("Desk".into(), Placed::at("desk", 0.0, 0.0))),
        windows_label: "Windows".into(),
        windows,
        overlays: Vec::new(),
        focus: focus.map(str::to_owned),
    }
}
