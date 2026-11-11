//! The data every part of the window manager shares: rects, offsets, a window's placement and the
//! fills it can take. The shapes and names are the runtime's (`SurfacePlacement` in
//! `packages/runtime/src/modes/types.ts`), so a profile or a session saved by the web desk reads
//! here unchanged and writes back the same JSON. Numbers are `f64` pixels, as in the runtime.

use serde::{Deserialize, Serialize};

/// A rectangle in pixels, its origin at the top left.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub const fn new(x: f64, y: f64, w: f64, h: f64) -> Self {
        Self { x, y, w, h }
    }

    /// Its right edge, `x + w`.
    pub fn right(&self) -> f64 {
        self.x + self.w
    }

    /// Its bottom edge, `y + h`.
    pub fn bottom(&self) -> f64 {
        self.y + self.h
    }

    /// Whether the two share any area (touching edges do not).
    pub fn overlaps(&self, other: &Rect) -> bool {
        self.x < other.right()
            && other.x < self.right()
            && self.y < other.bottom()
            && other.y < self.bottom()
    }
}

/// A point, or how far the canvas is panned: the canvas's origin on screen.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Offset {
    pub x: f64,
    pub y: f64,
}

impl Offset {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

/// A point on screen, in app pixels.
pub type Point = Offset;

/// A width and a height.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Size {
    pub w: f64,
    pub h: f64,
}

/// Room kept on each side of an area.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Insets {
    pub left: f64,
    pub right: f64,
    pub top: f64,
    pub bottom: f64,
}

/// What a filled window takes: the whole app (ADR 0132), an edge's half or a corner's quarter
/// (ADR 0128). A drag snaps to every fill but `Full`, which the title bar's double-click and
/// Maximize give.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Fill {
    Full,
    Left,
    Right,
    Top,
    Bottom,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl Fill {
    /// A quarter: one of the four corners.
    pub fn is_quarter(self) -> bool {
        matches!(
            self,
            Fill::TopLeft | Fill::TopRight | Fill::BottomLeft | Fill::BottomRight
        )
    }

    /// The bottom half or a bottom quarter.
    pub fn is_bottom(self) -> bool {
        matches!(self, Fill::Bottom | Fill::BottomLeft | Fill::BottomRight)
    }
}

/// Where a filled window comes back to: its place before it filled, in the coordinates of the mode
/// it had then, and that mode (`floating`; absent in layouts saved before snaps floated). A window
/// maximized from a half or a quarter also keeps that part (`fill`, never `Full`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Restore {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub floating: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Fill>,
}

impl Restore {
    pub fn rect(&self) -> Rect {
        Rect::new(self.x, self.y, self.w, self.h)
    }
}

/// How a window is split into panes. Only the shape lives here, with `leaves`: the operations on
/// the tree (split, close, ratios) are the panes module's (#79).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum PaneNode {
    /// One pane showing a view: `"calendar"`, `"launcher"`, `"agent:<id>"`, `"plugin:<id>"`, ...
    #[serde(rename = "view")]
    View { id: String, view: String },
    /// Two panes side by side (`Row`) or stacked (`Column`); `ratio` is the first one's share.
    #[serde(rename = "split")]
    Split {
        id: String,
        dir: SplitDir,
        ratio: f64,
        a: Box<PaneNode>,
        b: Box<PaneNode>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SplitDir {
    Row,
    Column,
}

impl PaneNode {
    /// One pane named `id` showing `view`.
    pub fn view(id: impl Into<String>, view: impl Into<String>) -> Self {
        PaneNode::View {
            id: id.into(),
            view: view.into(),
        }
    }

    /// The panes that show something, first to last: `(pane id, view)`.
    pub fn leaves(&self) -> Vec<(&str, &str)> {
        match self {
            PaneNode::View { id, view } => vec![(id.as_str(), view.as_str())],
            PaneNode::Split { a, b, .. } => {
                let mut all = a.leaves();
                all.extend(b.leaves());
                all
            }
        }
    }
}

/// A window on a desktop. A normal one (`floating` absent or false) keeps world pixels on the
/// desktop's canvas and moves with its pan; a floating one keeps the 1440×900 reference frame and
/// stays put on screen, above the normal ones.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Placement {
    pub id: String,
    pub plugin: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub pinned: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub floating: Option<bool>,
    /// Absent: one pane showing the view named by `id`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panes: Option<PaneNode>,
    /// Present only while the window fills the app or a part of it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restore: Option<Restore>,
    /// The part it fills until moved or resized. A fill floats the window (ADR 0128); a normal
    /// window filled before fills floated keeps the world rect it was filled to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Fill>,
}

impl Placement {
    /// A normal, unpinned window of one pane at `rect`.
    pub fn new(id: impl Into<String>, plugin: impl Into<String>, rect: Rect) -> Self {
        Self {
            id: id.into(),
            plugin: plugin.into(),
            x: rect.x,
            y: rect.y,
            w: rect.w,
            h: rect.h,
            pinned: false,
            floating: None,
            panes: None,
            restore: None,
            fill: None,
        }
    }

    /// Its stored rect, in the coordinates of its mode.
    pub fn rect(&self) -> Rect {
        Rect::new(self.x, self.y, self.w, self.h)
    }

    pub fn set_rect(&mut self, r: Rect) {
        self.x = r.x;
        self.y = r.y;
        self.w = r.w;
        self.h = r.h;
    }

    /// Its panes: as saved, or one pane `p1` showing the view named by its id.
    pub fn panes(&self) -> PaneNode {
        self.panes
            .clone()
            .unwrap_or_else(|| PaneNode::view("p1", self.id.clone()))
    }
}

/// A plugin surface the runtime handed to the window manager: its window's slot, kept while it
/// stays mounted, the pan its desktop had when it arrived (`at`) and the app's free area then
/// (`area`, #158), so the slot opens in sight and inside the app.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Adopted {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<Offset>,
    /// The free area its slot is laid in; `None`: the reference frame's (`geometry::FREE`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub area: Option<Rect>,
}

/// A key as the DOM names it (`KeyboardEvent.key`: `"ArrowLeft"`, `"Tab"`, `"Enter"`, ...), with
/// the modifiers the window manager reads.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyPress {
    pub key: String,
    #[serde(default)]
    pub shift: bool,
    #[serde(default)]
    pub meta: bool,
    #[serde(default)]
    pub ctrl: bool,
}

impl KeyPress {
    pub fn new(key: impl Into<String>) -> Self {
        Self {
            key: key.into(),
            ..Self::default()
        }
    }

    /// The same key with Shift held.
    pub fn with_shift(mut self) -> Self {
        self.shift = true;
        self
    }
}
