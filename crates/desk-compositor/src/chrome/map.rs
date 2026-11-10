//! The canvas map's chrome (ADR 0082, the runtime's `shell/minimap.css`): the box with the canvas
//! in it, each normal window (its thumbnail drawn by the caller between its fill and its edge, the
//! focused one marked), the part in sight and the fold button at the top right, or the button
//! alone, folded. The icons are drawn from rectangles: a bar to fold, a frame round a view to open.

use super::{Chrome, Role};
use crate::node::{NodeId, RectNode};
use crate::scene::{Scene, SceneError};
use crate::types::{Color, Rect, Stroke};

/// The open map's fold button, 20 px, 8 px in from the box's top right.
const FOLD: f32 = 20.0;
const FOLD_IN: f32 = 8.0;

/// A part of the canvas map.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MapPart {
    Frame,
    Canvas,
    /// A window's fill, under its thumbnail.
    Window {
        focused: bool,
    },
    /// A window's edge, over its thumbnail.
    Edge {
        focused: bool,
    },
    View,
    /// The fold button, folded (on its own, larger) or open.
    Button {
        folded: bool,
    },
    /// An icon's filled bar, and its outlined frame.
    IconBar,
    IconFrame,
}

/// The nodes of the map's box and its button.
#[derive(Clone, Debug, PartialEq)]
pub struct MapChrome {
    pub frame: Option<NodeId>,
    pub canvas: Option<NodeId>,
    pub button: NodeId,
    /// Every node made, the button's icon included.
    pub nodes: Vec<NodeId>,
}

impl Chrome {
    /// The map open in `outer` (its box) with its canvas at `canvas`, or folded to its button at
    /// `outer`.
    pub fn map(
        &mut self,
        scene: &mut Scene,
        parent: NodeId,
        outer: Rect,
        canvas: Rect,
        folded: bool,
    ) -> Result<MapChrome, SceneError> {
        let part = |p| Role::Map(p);
        let mut nodes = Vec::new();
        let (frame, canvas_node) = if folded {
            (None, None)
        } else {
            let frame = self.add(scene, parent, part(MapPart::Frame), outer, "")?;
            let canvas = self.add(scene, parent, part(MapPart::Canvas), canvas, "")?;
            nodes.extend([frame, canvas]);
            (Some(frame), Some(canvas))
        };
        let at = if folded {
            outer
        } else {
            let x = outer.x + outer.width - FOLD_IN - FOLD;
            Rect::new(x, outer.y + FOLD_IN, FOLD, FOLD)
        };
        let button = self.add(scene, parent, part(MapPart::Button { folded }), at, "")?;
        nodes.push(button);
        let (cx, cy) = (at.x + at.width / 2.0, at.y + at.height / 2.0);
        if folded {
            // The map: a frame, and the part in sight in it.
            let frame = Rect::new(cx - 7.0, cy - 5.5, 14.0, 11.0);
            let view = Rect::new(cx - 1.0, cy - 2.5, 6.0, 5.0);
            nodes.push(self.add(scene, parent, part(MapPart::IconFrame), frame, "")?);
            nodes.push(self.add(scene, parent, part(MapPart::IconBar), view, "")?);
        } else {
            let bar = Rect::new(cx - 5.0, cy - 0.75, 10.0, 1.5);
            nodes.push(self.add(scene, parent, part(MapPart::IconBar), bar, "")?);
        }
        Ok(MapChrome {
            frame,
            canvas: canvas_node,
            button,
            nodes,
        })
    }

    /// A window in the map at `rect`: its fill (`edge` false, drawn under its thumbnail) or its
    /// edge (over it).
    pub fn map_window(
        &mut self,
        scene: &mut Scene,
        parent: NodeId,
        rect: Rect,
        focused: bool,
        edge: bool,
    ) -> Result<NodeId, SceneError> {
        let role = if edge {
            MapPart::Edge { focused }
        } else {
            MapPart::Window { focused }
        };
        self.add(scene, parent, Role::Map(role), rect, "")
    }

    /// The part in sight, in the map at `rect`.
    pub fn map_view(
        &mut self,
        scene: &mut Scene,
        parent: NodeId,
        rect: Rect,
    ) -> Result<NodeId, SceneError> {
        self.add(scene, parent, Role::Map(MapPart::View), rect, "")
    }

    pub(super) fn map_node(&self, part: MapPart, base: Rect) -> crate::Node {
        let m = &self.theme.map;
        let border = |width: f32, color: Color| Some(Stroke { width, color });
        let rect = |fill: Color, stroke: Option<Stroke>, radius: f32| RectNode {
            stroke,
            radius,
            ..RectNode::new(base, fill)
        };
        let node = match part {
            MapPart::Frame => RectNode {
                shadow: m.shadow,
                ..rect(m.fill, border(1.0, m.border), m.radius)
            },
            MapPart::Canvas => rect(m.canvas, None, m.canvas_radius),
            MapPart::Window { focused: false } => rect(m.window, None, m.small_radius),
            MapPart::Window { focused: true } => rect(m.focused, None, m.small_radius),
            MapPart::Edge { focused } => {
                let color = if focused {
                    m.focused_border
                } else {
                    m.window_border
                };
                rect(Color::TRANSPARENT, border(1.0, color), m.small_radius)
            }
            MapPart::View => rect(m.view, border(2.0, m.view_border), m.small_radius),
            MapPart::Button { folded: true } => RectNode {
                shadow: m.shadow,
                ..rect(m.fill, border(1.0, m.border), m.canvas_radius)
            },
            MapPart::Button { folded: false } => rect(Color::TRANSPARENT, None, m.small_radius),
            MapPart::IconBar => rect(m.icon, None, 0.75),
            MapPart::IconFrame => rect(Color::TRANSPARENT, border(1.5, m.icon), 2.0),
        };
        node.into()
    }
}
