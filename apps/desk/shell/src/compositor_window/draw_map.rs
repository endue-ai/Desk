//! The canvas map's scene (ADR 0082, #54, ADR 0270; the runtime's `shell/Minimap.ts` and
//! `minimap.css`, which it replaces): in the bottom right, under the right rail, the desktop in
//! front drawn whole in its box, every normal window to scale with its icon in it (the one its
//! title bar shows, from the page's report), the focused one marked, and the part in sight as a
//! frame; or, folded, its button alone beside the free area. The person resizes the open box from
//! grips along its left and top edges, in the frame's proportions (`desk_wm::map_size`); a box
//! too tall to lie under the rail goes left of the rail's column. Floating windows are always in
//! sight, so it leaves them out. Units are CSS pixels in the desk's group.

use desk_compositor::{Chrome, GroupNode, NodeId, Rect, Scene, SceneError, SurfaceNode, TextureId};
use desk_wm::{Fit, MAP, MapEdges, fit_world, is_floating, map_size, to_map, view_rect, world_of};

use super::draw::{pass, rect};
use super::hosted::Hosted;

/// From the app's right edge to the map's, as the bars keep from it, and from the bottom.
const RIGHT: f32 = 24.0;
/// In an app too short for the map to lie under the right rail, it goes left of the rail's column
/// (the rail's 24 and 56, then 12).
const RIGHT_SHORT: f32 = 92.0;
/// Half the right rail's height (322 px, centred) and the room it keeps above the map's box.
const RAIL_HALF: f32 = 161.0;
const RAIL_GAP: f32 = 12.0;
const BOTTOM: f32 = 64.0;
/// Round the canvas: the box's padding, and its border.
const PAD: f32 = 5.0;
/// The smallest a window is drawn in the map.
const LEAST: f32 = 2.0;
/// A window's icon: this share of its box's shorter side, at most `ICON_MOST`, and none in a box
/// whose share is under `ICON_LEAST`.
const ICON_SHARE: f32 = 0.5;
const ICON_MOST: f32 = 28.0;
const ICON_LEAST: f32 = 6.0;
/// The grips: bands `GRIP` wide along the box's left and top edges, half outside it, a square at
/// the corner between them; the top one stops `GRIP_CLEAR` short of the right edge, where the fold
/// button is.
const GRIP: f32 = 8.0;
const GRIP_CLEAR: f32 = 36.0;

/// The shortest app whose rail ends `RAIL_GAP` above a map box `outer` high (734 for `MAP`'s 130).
pub fn tall(outer: f32) -> f32 {
    2.0 * (BOTTOM + outer + RAIL_GAP + RAIL_HALF)
}

/// One window as the map draws it: its box in the map, and its icon, the path data of the view
/// its title bar names with the square it is drawn in.
#[derive(Clone, Debug, PartialEq)]
pub struct MapWindow {
    pub id: String,
    pub rect: Rect,
    pub focused: bool,
    pub icon: Option<(String, Rect)>,
}

/// Where everything of the map goes, in the desk's CSS pixels.
#[derive(Clone, Debug, PartialEq)]
pub struct MapLayout {
    /// The canvas's width, as `desk_wm::map_size` holds it.
    pub width: f64,
    /// The open box, and the canvas in it.
    pub outer: Rect,
    pub canvas: Rect,
    /// The folded button.
    pub button: Rect,
    pub fit: Fit,
    pub windows: Vec<MapWindow>,
    /// The part in sight.
    pub view: Rect,
    /// The open box's grips, and the edges each resizes.
    pub grips: Vec<(MapEdges, Rect)>,
}

/// What the map is drawn from: its layout, whether it is folded and each window's icon, by id.
pub struct MapSource<'a> {
    pub layout: &'a MapLayout,
    pub folded: bool,
    pub icon: &'a dyn Fn(&str) -> Option<TextureId>,
}

/// The map's nodes as drawn, for its pointer.
#[derive(Clone, Debug, PartialEq)]
pub struct MapDrawn {
    pub button: NodeId,
    pub canvas: Option<NodeId>,
    pub view: Option<NodeId>,
    /// The grips, and the edges each resizes.
    pub grips: Vec<(NodeId, MapEdges)>,
    pub nodes: Vec<NodeId>,
}

/// The square a `rect` window's icon is drawn in, centred on whole pixels; none in too small a box.
fn icon_square(rect: Rect) -> Option<Rect> {
    let share = rect.width.min(rect.height) * ICON_SHARE;
    if share < ICON_LEAST {
        return None;
    }
    let side = share.min(ICON_MOST).floor();
    let x = (rect.x + (rect.width - side) / 2.0).round();
    let y = (rect.y + (rect.height - side) / 2.0).round();
    Some(Rect::new(x, y, side, side))
}

/// The grips of an open box at `outer`: the corner, the left edge and the top one.
fn grips(outer: Rect) -> Vec<(MapEdges, Rect)> {
    let half = GRIP / 2.0;
    let edges = |left, top| MapEdges { left, top };
    let (x, y) = (outer.x - half, outer.y - half);
    vec![
        (edges(true, true), Rect::new(x, y, GRIP * 1.5, GRIP * 1.5)),
        (
            edges(true, false),
            Rect::new(x, y + GRIP * 1.5, GRIP, outer.height + half - GRIP * 1.5),
        ),
        (
            edges(false, true),
            Rect::new(
                x + GRIP * 1.5,
                y,
                (outer.width + half - GRIP * 1.5 - GRIP_CLEAR).max(0.0),
                GRIP,
            ),
        ),
    ]
}

/// The map's layout on the hosted desk; `held` is the fit a drag holds, so the map stays still,
/// and `width` the canvas's while a resize lasts (else the report's, else `MAP`'s).
pub fn layout(hosted: &Hosted, held: Option<Fit>, width: Option<f64>) -> Option<MapLayout> {
    let plan = hosted.plan()?;
    let report = hosted.report();
    let (vw, vh) = (plan.screen.w as f32, plan.screen.h as f32);
    let size = map_size(width.or(report.and_then(|r| r.map.width)).unwrap_or(MAP.w));
    let (mw, mh) = (size.w as f32, size.h as f32);
    // The map goes with the right rail while a window fills the app (ADR 0221).
    let shift = report.map_or(0.0, |r| r.map.shift);
    let right = if vh < tall(mh + 2.0 * PAD) {
        RIGHT_SHORT
    } else {
        RIGHT
    } - shift;
    let canvas = Rect::new(vw - right - PAD - mw, vh - BOTTOM - PAD - mh, mw, mh);
    let outer = canvas.inflate(PAD);
    let button = Rect::new(vw - right - 32.0, vh - BOTTOM - 32.0, 32.0, 32.0);
    let desk = hosted.wm.desk();
    let pan = desk.pan_of(&desk.here());
    let focused = desk.focused_window();
    let normal: Vec<desk_wm::Placement> = desk
        .windows()
        .into_iter()
        .filter(|p| !is_floating(p))
        .collect();
    let view = view_rect(pan, plan.screen.w, plan.screen.h);
    let rects: Vec<desk_wm::Rect> = normal.iter().map(|p| p.rect()).collect();
    let fit = held.unwrap_or_else(|| fit_world(world_of(&rects, view), size));
    let in_map = |r: desk_wm::Rect| {
        let m = rect(to_map(r, fit));
        Rect::new(
            canvas.x + m.x,
            canvas.y + m.y,
            m.width.max(LEAST),
            m.height.max(LEAST),
        )
    };
    // The view its title bar names: the pane in use, else the first.
    let icon_of = |id: &str| {
        let panes = &plan.window(id)?.panes;
        let pane = panes.iter().find(|p| p.focused).or(panes.first())?;
        report?.icons.get(&pane.view).cloned()
    };
    let windows = normal
        .iter()
        .map(|p| {
            let at = in_map(p.rect());
            MapWindow {
                id: p.id.clone(),
                rect: at,
                focused: focused.as_deref() == Some(p.id.as_str()),
                icon: icon_of(&p.id).zip(icon_square(at)),
            }
        })
        .collect();
    Some(MapLayout {
        width: size.w,
        outer,
        canvas,
        button,
        fit,
        windows,
        view: in_map(view),
        grips: grips(outer),
    })
}

/// Draw the map in `desk` (the desk's CSS group).
pub fn draw(
    scene: &mut Scene,
    chrome: &mut Chrome,
    desk: NodeId,
    map: &MapSource,
) -> Result<MapDrawn, SceneError> {
    let l = map.layout;
    let at = if map.folded { l.button } else { l.outer };
    let made = chrome.map(scene, desk, at, l.canvas, map.folded)?;
    // The button and its icon, which go over the canvas's windows.
    let after = made
        .nodes
        .iter()
        .position(|n| *n == made.button)
        .unwrap_or(0);
    let button: Vec<NodeId> = made.nodes[after..].to_vec();
    // The icon lets the pointer through to its button.
    pass(scene, button.iter().copied().filter(|n| *n != made.button))?;
    let mut drawn = MapDrawn {
        button: made.button,
        canvas: made.canvas,
        view: None,
        grips: Vec::new(),
        nodes: made.nodes,
    };
    if map.folded {
        return Ok(drawn);
    }
    // What lies past the canvas's edge is cut off, as `overflow: hidden` did.
    let clip = GroupNode {
        clip: Some(l.canvas),
        ..GroupNode::default()
    };
    let inside = scene.insert(desk, clip)?;
    for w in &l.windows {
        drawn
            .nodes
            .push(chrome.map_window(scene, inside, w.rect, w.focused, false)?);
        if let (Some((_, square)), Some(texture)) = (&w.icon, (map.icon)(&w.id)) {
            let icon = scene.insert(inside, SurfaceNode::new(*square, texture))?;
            drawn.nodes.push(icon);
        }
        drawn
            .nodes
            .push(chrome.map_window(scene, inside, w.rect, w.focused, true)?);
    }
    let view = chrome.map_view(scene, inside, l.view)?;
    drawn.view = Some(view);
    drawn.nodes.push(view);
    for (edges, at) in &l.grips {
        let grip = chrome.map_grip(scene, desk, *at)?;
        drawn.grips.push((grip, *edges));
        drawn.nodes.push(grip);
    }
    // The fold button over the canvas, which hit testing finds first.
    for node in button {
        scene.reorder(node, usize::MAX)?;
    }
    Ok(drawn)
}

#[cfg(test)]
#[path = "draw_map_tests.rs"]
mod tests;
