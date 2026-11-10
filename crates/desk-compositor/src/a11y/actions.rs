//! What an assistive technology asks for, turned into what the shell does (`accessibility.md`
//! § Actions): a node of a surface's tree gets an `a11y.action`, its window raised first for a
//! click or the focus, as a person's press would; a scroll is a wheel over the node; a button of
//! the compositor's is a press where it is drawn, as a person's click, or the action of the
//! surface's node it stands for.

use accesskit::{Action, ActionData, ActionRequest, NodeId, ScrollUnit};
use desk_surface::generated::{SurfaceA11yAction, SurfaceA11yActionName, SurfaceWheelUnit};

use super::DeskA11y;
use super::chrome::{Does, Press};
use super::roles::name_of;

/// One thing the shell does for a request.
#[derive(Clone, Debug, PartialEq)]
pub enum Request {
    /// An `a11y.action` for a surface.
    Surface(SurfaceA11yAction),
    /// A wheel over surface `surface` at its point `at` (`pointer.wheel`, the DOM's signs).
    Wheel {
        surface: String,
        at: (f64, f64),
        delta: (f64, f64),
        unit: SurfaceWheelUnit,
    },
    /// A press at a point of the window, in its logical pixels.
    Press { at: (f32, f32) },
    /// The keyboard focus to surface `surface`, its window raised, as the page moves it.
    Focus { surface: String },
}

fn surface_action(surface: &str, node: u64, action: SurfaceA11yActionName) -> Request {
    Request::Surface(SurfaceA11yAction {
        r#type: Default::default(),
        surface: surface.to_owned(),
        node,
        action,
        value: None,
    })
}

impl DeskA11y {
    /// What to do for `request`; nothing for a node the desk does not know or an action it
    /// cannot do.
    pub fn request(&self, request: &ActionRequest) -> Vec<Request> {
        if request.target_tree == accesskit::TreeId::ROOT {
            return self.chrome_request(request.action, request.target_node);
        }
        let Some(surface) = self.surface_of_tree(request.target_tree) else {
            return Vec::new();
        };
        let NodeId(node) = request.target_node;
        let Some(tree) = self.tree(&surface) else {
            return Vec::new();
        };
        if tree.node(node).is_none() || tree.unavailable() {
            return Vec::new();
        }
        let scroll = |dx: f64, dy: f64| {
            let b = tree.node(node)?.bounds.as_ref()?;
            let (unit, n) = match request.data {
                Some(ActionData::ScrollUnit(ScrollUnit::Page)) => (SurfaceWheelUnit::Page, 1.0),
                _ => (SurfaceWheelUnit::Line, 3.0),
            };
            Some(vec![Request::Wheel {
                surface: surface.clone(),
                at: (b.x + b.width / 2.0, b.y + b.height / 2.0),
                delta: (dx * n, dy * n),
                unit,
            }])
        };
        let wheel = match request.action {
            Action::ScrollUp => scroll(0.0, -1.0),
            Action::ScrollDown => scroll(0.0, 1.0),
            Action::ScrollLeft => scroll(-1.0, 0.0),
            Action::ScrollRight => scroll(1.0, 0.0),
            _ => None,
        };
        if let Some(wheel) = wheel {
            return wheel;
        }
        let Some(name) = name_of(request.action) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        if matches!(
            name,
            SurfaceA11yActionName::Click | SurfaceA11yActionName::Focus
        ) {
            out.push(Request::Focus {
                surface: surface.clone(),
            });
        }
        let mut action = surface_action(&surface, node, name);
        if let Request::Surface(a) = &mut action {
            a.value = match &request.data {
                Some(ActionData::Value(v)) => Some(v.to_string()),
                Some(ActionData::NumericValue(n)) => Some(n.to_string()),
                _ => None,
            };
        }
        out.push(action);
        out
    }

    fn chrome_request(&self, action: Action, node: NodeId) -> Vec<Request> {
        let Some(does) = self.built().does.get(&node) else {
            return Vec::new();
        };
        match (does, action) {
            (Does::Press(Press::At(x, y)), Action::Click) => vec![Request::Press { at: (*x, *y) }],
            (Does::Press(Press::Node { surface, node }), Action::Click) => {
                vec![surface_action(surface, *node, SurfaceA11yActionName::Click)]
            }
            (Does::Raise { at }, Action::Click | Action::Focus) => {
                vec![Request::Press { at: *at }]
            }
            _ => Vec::new(),
        }
    }
}
