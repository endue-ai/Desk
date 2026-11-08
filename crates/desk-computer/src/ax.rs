//! The accessibility tree: elements, how to name one again, what to do to it, and how to find one.
//!
//! An element is named by its pid and its path, the child indexes (`AXChildren`) from the
//! application element down; the application itself has the empty path. A path is only as good as
//! the interface it was read from, so an `ElementRef` may also carry the role it expects: an action
//! on an element whose role changed answers `not_found` instead of pressing something else.
//!
//! `walk` visits a `Source` breadth first within a `Budget` of depth and nodes, so the shallow
//! structure of a large app comes back before its depths; the OS walker and the fake share it.

mod walker;

pub use walker::{Source, find, tree, walk};

use crate::Rect;

/// The most any walk visits, whatever its budget asks.
pub const MAX_DEPTH: u32 = 64;
pub const MAX_NODES: u32 = 5_000;
/// Longer titles, values and descriptions are cut to this many characters, with `…`.
pub const MAX_TEXT: usize = 2_000;

/// How far a walk goes: `depth` levels below its root (0 is the root alone) and at most `nodes`
/// elements, the root included.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Budget {
    pub depth: u32,
    pub nodes: u32,
}

impl Budget {
    pub fn new(depth: u32, nodes: u32) -> Self {
        Self { depth, nodes }
    }

    /// Within `MAX_DEPTH` and `MAX_NODES`, and at least the root.
    pub fn clamped(self) -> Self {
        Self {
            depth: self.depth.min(MAX_DEPTH),
            nodes: self.nodes.clamp(1, MAX_NODES),
        }
    }
}

impl Default for Budget {
    /// Ten levels and 500 elements: a window's controls, without every row of a long list.
    fn default() -> Self {
        Self::new(10, 500)
    }
}

/// One element's attributes, as a walk read them.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Element {
    /// Child indexes from the application element.
    pub path: Vec<u32>,
    /// `AXRole`, such as `AXButton`.
    pub role: String,
    pub subrole: Option<String>,
    pub title: Option<String>,
    /// `AXValue` as text: a field's contents, a checkbox's `1` or `0`, a slider's number.
    pub value: Option<String>,
    pub description: Option<String>,
    /// `AXPosition` and `AXSize`, in global points.
    pub frame: Option<Rect>,
    pub enabled: bool,
    pub focused: bool,
    /// The AX actions it offers, such as `AXPress`.
    pub actions: Vec<String>,
}

impl Element {
    /// An enabled element with `role` and nothing else, for scripted trees.
    pub fn new(role: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            enabled: true,
            ..Self::default()
        }
    }

    pub fn subrole(mut self, subrole: impl Into<String>) -> Self {
        self.subrole = Some(subrole.into());
        self
    }

    pub fn title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    pub fn value(mut self, value: impl Into<String>) -> Self {
        self.value = Some(value.into());
        self
    }

    pub fn description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    pub fn frame(mut self, frame: Rect) -> Self {
        self.frame = Some(frame);
        self
    }

    pub fn enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub fn focused(mut self, focused: bool) -> Self {
        self.focused = focused;
        self
    }

    pub fn actions(mut self, actions: &[&str]) -> Self {
        self.actions = actions.iter().map(|a| (*a).to_owned()).collect();
        self
    }

    /// How to name it again in `pid`, expecting its role.
    pub fn reference(&self, pid: i32) -> ElementRef {
        ElementRef::new(pid, self.path.clone()).expecting(&self.role)
    }

    /// Its title, else its description, else its value: what a person would read on it.
    pub fn label(&self) -> Option<&str> {
        [&self.title, &self.description, &self.value]
            .into_iter()
            .flatten()
            .map(String::as_str)
            .find(|text| !text.trim().is_empty())
    }
}

/// An element and the children a walk read below it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Node {
    pub element: Element,
    pub children: Vec<Node>,
    /// How many children the element has: more than `children.len()` where the budget stopped,
    /// `None` where the walk never asked (the node budget ran out first).
    pub child_count: Option<u32>,
}

impl Node {
    pub fn new(element: Element) -> Self {
        Self {
            element,
            children: Vec::new(),
            child_count: Some(0),
        }
    }

    /// With `children` below it, for scripted trees.
    pub fn with(mut self, children: Vec<Node>) -> Self {
        self.child_count = Some(children.len() as u32);
        self.children = children;
        self
    }

    /// Every node, this one first, breadth first.
    pub fn flatten(&self) -> Vec<&Node> {
        let mut nodes = vec![self];
        let mut next = 0;
        while next < nodes.len() {
            let node = nodes[next];
            nodes.extend(node.children.iter());
            next += 1;
        }
        nodes
    }
}

/// What a walk read: the root node with its descendants, and whether the budget cut any.
#[derive(Debug, Clone, PartialEq)]
pub struct Tree {
    pub pid: i32,
    pub root: Node,
    /// How many elements it holds.
    pub nodes: u32,
    /// Whether some element has children the walk left out.
    pub truncated: bool,
}

/// An element named by its app's pid and its path from the application element.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ElementRef {
    pub pid: i32,
    pub path: Vec<u32>,
    /// The role the element must still have, if any.
    pub role: Option<String>,
}

impl ElementRef {
    pub fn new(pid: i32, path: Vec<u32>) -> Self {
        Self {
            pid,
            path,
            role: None,
        }
    }

    /// The application element of `pid`.
    pub fn app(pid: i32) -> Self {
        Self::new(pid, Vec::new())
    }

    pub fn expecting(mut self, role: &str) -> Self {
        self.role = Some(role.to_owned());
        self
    }

    /// `pid 412, path 0/3/1`.
    pub fn describe(&self) -> String {
        if self.path.is_empty() {
            return format!("the app of pid {}", self.pid);
        }
        let path: Vec<String> = self.path.iter().map(u32::to_string).collect();
        format!("element {} of pid {}", path.join("/"), self.pid)
    }

    /// `not_found` when `actual` is not the role this reference expects.
    pub fn check_role(&self, actual: &str) -> Result<(), crate::Error> {
        match &self.role {
            Some(role) if normalize_role(role) != normalize_role(actual) => {
                Err(crate::not_found(format!(
                    "{} is now {actual}, not {role}; read the tree again",
                    self.describe()
                )))
            }
            _ => Ok(()),
        }
    }
}

/// The AX actions `Control` may perform.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AxAction {
    Press,
    Raise,
    ShowMenu,
    Confirm,
    Cancel,
    Increment,
    Decrement,
    Pick,
}

impl AxAction {
    pub const ALL: [AxAction; 8] = [
        AxAction::Press,
        AxAction::Raise,
        AxAction::ShowMenu,
        AxAction::Confirm,
        AxAction::Cancel,
        AxAction::Increment,
        AxAction::Decrement,
        AxAction::Pick,
    ];

    /// The AX name, such as `AXPress`.
    pub fn name(self) -> &'static str {
        match self {
            AxAction::Press => "AXPress",
            AxAction::Raise => "AXRaise",
            AxAction::ShowMenu => "AXShowMenu",
            AxAction::Confirm => "AXConfirm",
            AxAction::Cancel => "AXCancel",
            AxAction::Increment => "AXIncrement",
            AxAction::Decrement => "AXDecrement",
            AxAction::Pick => "AXPick",
        }
    }

    /// From its AX name, with or without the `AX` prefix, in any case.
    pub fn parse(name: &str) -> Option<Self> {
        let wanted = normalize_role(name);
        Self::ALL
            .into_iter()
            .find(|action| normalize_role(action.name()) == wanted)
    }
}

/// An attribute `Control` may set.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Setting {
    /// `AXValue` as text: a field's contents.
    Value(String),
    /// `AXFocused`: move keyboard focus to the element (or away).
    Focused(bool),
}

impl Setting {
    pub fn attribute(&self) -> &'static str {
        match self {
            Setting::Value(_) => "AXValue",
            Setting::Focused(_) => "AXFocused",
        }
    }
}

/// Which elements `find` answers.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Query {
    /// A role or subrole, with or without `AX` and in any case: `button` finds `AXButton`.
    pub role: Option<String>,
    /// Text in the title, description or value; case-insensitive and anywhere unless `exact`.
    pub title: Option<String>,
    /// The title must equal the text (both trimmed), case included.
    pub exact: bool,
    /// At most this many elements, nearest the root first.
    pub limit: u32,
}

impl Query {
    /// Up to 20 elements of any role and title.
    pub fn any() -> Self {
        Self {
            role: None,
            title: None,
            exact: false,
            limit: 20,
        }
    }

    pub fn role(mut self, role: impl Into<String>) -> Self {
        self.role = Some(role.into());
        self
    }

    pub fn title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    pub fn exact(mut self) -> Self {
        self.exact = true;
        self
    }

    pub fn limit(mut self, limit: u32) -> Self {
        self.limit = limit;
        self
    }

    /// Whether `element` is one this query asks for.
    pub fn matches(&self, element: &Element) -> bool {
        let role = self.role.as_deref().is_none_or(|role| {
            let wanted = normalize_role(role);
            normalize_role(&element.role) == wanted
                || element
                    .subrole
                    .as_deref()
                    .is_some_and(|sub| normalize_role(sub) == wanted)
        });
        let title = self.title.as_deref().is_none_or(|wanted| {
            [&element.title, &element.description, &element.value]
                .into_iter()
                .flatten()
                .any(|text| text_matches(text, wanted, self.exact))
        });
        role && title
    }
}

fn text_matches(text: &str, wanted: &str, exact: bool) -> bool {
    if exact {
        text.trim() == wanted.trim()
    } else {
        text.to_lowercase().contains(&wanted.trim().to_lowercase())
    }
}

/// A role in lower case without its `AX` prefix: `AXButton`, `axbutton` and `button` are `button`.
pub fn normalize_role(role: &str) -> String {
    let lower = role.trim().to_lowercase();
    match lower.strip_prefix("ax") {
        Some(rest) if !rest.is_empty() => rest.to_owned(),
        _ => lower,
    }
}

/// `text` cut to `MAX_TEXT` characters, with `…` when it was longer.
pub fn clip(text: String) -> String {
    match text.char_indices().nth(MAX_TEXT) {
        Some((end, _)) => format!("{}…", &text[..end]),
        None => text,
    }
}
