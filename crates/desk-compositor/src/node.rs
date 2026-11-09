//! Scene nodes: plain data the window manager and system surfaces fill in without knowing wgpu.

use crate::types::{Color, Rect, Shadow, Stroke, TextureId};
use glam::Mat4;

/// A node's handle in its [`crate::Scene`]. Ids are never reused within one scene.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct NodeId(pub(crate) u64);

impl NodeId {
    /// The id as a number, for logs and maps outside the scene.
    pub fn raw(self) -> u64 {
        self.0
    }
}

/// A rectangle the compositor draws itself: window frames, title bars, bars, previews.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RectNode {
    pub rect: Rect,
    pub fill: Color,
    pub stroke: Option<Stroke>,
    pub radius: f32,
    pub shadow: Option<Shadow>,
}

impl RectNode {
    /// A filled rectangle with square corners, no stroke and no shadow.
    pub fn new(rect: Rect, fill: Color) -> RectNode {
        RectNode {
            rect,
            fill,
            stroke: None,
            radius: 0.0,
            shadow: None,
        }
    }
}

/// A texture another process (or the caller) rendered, placed as a quad. `uv` picks the part of the
/// texture shown (normalised, [`Rect::UNIT`] for all of it); the texture is premultiplied alpha.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SurfaceNode {
    pub rect: Rect,
    pub texture: TextureId,
    pub uv: Rect,
    pub opacity: f32,
    /// Rounded corners, as a window's content has under a rounded frame.
    pub radius: f32,
}

impl SurfaceNode {
    /// All of `texture`, opaque, square corners.
    pub fn new(rect: Rect, texture: TextureId) -> SurfaceNode {
        SurfaceNode {
            rect,
            texture,
            uv: Rect::UNIT,
            opacity: 1.0,
            radius: 0.0,
        }
    }
}

/// A group of children drawn in order (the last on top) through one transform. The transform maps
/// the children's units to the parent's: 2D (translate, scale, rotate about Z) or 3D (tilts, seen
/// through a perspective camera). Opacity multiplies into every child. `clip`, in the children's
/// units, hides what falls outside it. Children are kept by the scene ([`crate::Scene::children`]).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GroupNode {
    pub transform: Mat4,
    pub opacity: f32,
    pub clip: Option<Rect>,
}

impl Default for GroupNode {
    fn default() -> GroupNode {
        GroupNode {
            transform: Mat4::IDENTITY,
            opacity: 1.0,
            clip: None,
        }
    }
}

impl GroupNode {
    /// A group moved by `(x, y)`, nothing else.
    pub fn translated(x: f32, y: f32) -> GroupNode {
        GroupNode {
            transform: Mat4::from_translation(glam::Vec3::new(x, y, 0.0)),
            ..GroupNode::default()
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum NodeKind {
    Rect(RectNode),
    Surface(SurfaceNode),
    Group(GroupNode),
}

/// One node: what it is, and whether hit testing sees it. `hit: false` lets the pointer through the
/// node and, for a group, through its whole subtree (an overlay that is not active).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Node {
    pub kind: NodeKind,
    pub hit: bool,
}

impl Node {
    /// The same node, seen by hit testing or not.
    pub fn with_hit(self, hit: bool) -> Node {
        Node { hit, ..self }
    }

    pub fn is_group(&self) -> bool {
        matches!(self.kind, NodeKind::Group(_))
    }

    /// The rectangle a leaf covers in its parent's units (shadows and strokes aside); `None` for
    /// groups.
    pub fn rect(&self) -> Option<Rect> {
        match &self.kind {
            NodeKind::Rect(r) => Some(r.rect),
            NodeKind::Surface(s) => Some(s.rect),
            NodeKind::Group(_) => None,
        }
    }

    /// Everything a leaf paints in its parent's units, shadow included; `None` for groups.
    pub(crate) fn paint_bounds(&self) -> Option<Rect> {
        match &self.kind {
            NodeKind::Rect(r) => {
                let own = r.rect;
                Some(match &r.shadow {
                    Some(shadow) => own.union(&shadow.bounds(&own)),
                    None => own,
                })
            }
            NodeKind::Surface(s) => Some(s.rect),
            NodeKind::Group(_) => None,
        }
    }
}

macro_rules! node_from {
    ($ty:ty, $variant:ident) => {
        impl From<$ty> for Node {
            fn from(value: $ty) -> Node {
                Node {
                    kind: NodeKind::$variant(value),
                    hit: true,
                }
            }
        }
    };
}

node_from!(RectNode, Rect);
node_from!(SurfaceNode, Surface);
node_from!(GroupNode, Group);
