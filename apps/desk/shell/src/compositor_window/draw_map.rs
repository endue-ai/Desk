//! The canvas map's scene (ADR 0082, #54; the runtime's `shell/Minimap.ts` and `minimap.css`, which
//! it replaces): in the bottom right beside the arrange strip, the desktop in front drawn whole in
//! its box, every normal window to scale from its panes' thumbnails (downscaled surface textures,
//! `minimap.rs`), the focused one marked, and the part in sight as a frame; or, folded, its button
//! alone between the strip and the free area. Floating windows are always in sight, so it leaves
//! them out. Units are CSS pixels in the desk's group.

use desk_compositor::{Chrome, GroupNode, NodeId, Rect, Scene, SceneError, SurfaceNode, TextureId};
use desk_wm::{Fit, MAP, fit_world, is_floating, to_map, view_rect, world_of};

use super::draw::{pass, rect};
use super::hosted::Hosted;

/// From the app's right edge to the map's (the strip's column and its gap), and from the bottom.
const RIGHT: f32 = 70.0;
/// A short app lays the strip out as a row: the map goes left of it.
const RIGHT_SHORT: f32 = 195.0;
const BOTTOM: f32 = 64.0;
/// Round the canvas: the box's padding, and its border.
const PAD: f32 = 5.0;
/// The smallest a window is drawn in the map.
const LEAST: f32 = 2.0;

/// One window as the map draws it: its box in the map, and each plugin pane's box with the surface
/// host whose thumbnail fills it.
#[derive(Clone, Debug, PartialEq)]
pub struct MapWindow {
    pub id: String,
    pub rect: Rect,
    pub focused: bool,
    pub panes: Vec<(String, Rect)>,
}

/// Where everything of the map goes, in the desk's CSS pixels.
#[derive(Clone, Debug, PartialEq)]
pub struct MapLayout {
    /// The open box, and the canvas in it.
    pub outer: Rect,
    pub canvas: Rect,
    /// The folded button.
    pub button: Rect,
    pub fit: Fit,
    pub windows: Vec<MapWindow>,
    /// The part in sight.
    pub view: Rect,
}

/// What the map is drawn from: its layout, whether it is folded and each pane's thumbnail.
pub struct MapSource<'a> {
    pub layout: &'a MapLayout,
    pub folded: bool,
    pub thumbnail: &'a dyn Fn(&str) -> Option<TextureId>,
}

/// The map's nodes as drawn, for its pointer.
#[derive(Clone, Debug, PartialEq)]
pub struct MapDrawn {
    pub button: NodeId,
    pub canvas: Option<NodeId>,
    pub view: Option<NodeId>,
    pub nodes: Vec<NodeId>,
}

/// The map's layout on the hosted desk; `held` is the fit a drag holds, so the map stays still.
pub fn layout(hosted: &Hosted, held: Option<Fit>) -> Option<MapLayout> {
    let plan = hosted.plan()?;
    let (vw, vh) = (plan.screen.w as f32, plan.screen.h as f32);
    let right = if vh < 720.0 { RIGHT_SHORT } else { RIGHT };
    let (mw, mh) = (MAP.w as f32, MAP.h as f32);
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
    let fit = held.unwrap_or_else(|| fit_world(world_of(&rects, view), MAP));
    let in_map = |r: desk_wm::Rect| {
        let m = rect(to_map(r, fit));
        Rect::new(
            canvas.x + m.x,
            canvas.y + m.y,
            m.width.max(LEAST),
            m.height.max(LEAST),
        )
    };
    let host = |plugin: &str| hosted.frame(plugin).map(|f| f.host.clone());
    let windows = normal
        .iter()
        .map(|p| {
            // A pane's box on screen, back on the canvas: the window's panes move with the pan.
            let panes = (plan.window(&p.id).map(|w| w.panes.as_slice()))
                .unwrap_or_default()
                .iter()
                .filter_map(|pane| {
                    let body = pane.body;
                    let world = desk_wm::Rect::new(body.x - pan.x, body.y - pan.y, body.w, body.h);
                    Some((host(pane.plugin.as_deref()?)?, in_map(world)))
                })
                .collect();
            MapWindow {
                id: p.id.clone(),
                rect: in_map(p.rect()),
                focused: focused.as_deref() == Some(p.id.as_str()),
                panes,
            }
        })
        .collect();
    Some(MapLayout {
        outer,
        canvas,
        button,
        fit,
        windows,
        view: in_map(view),
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
        for (host, at) in &w.panes {
            if let Some(texture) = (map.thumbnail)(host) {
                drawn
                    .nodes
                    .push(scene.insert(inside, SurfaceNode::new(*at, texture))?);
            }
        }
        drawn
            .nodes
            .push(chrome.map_window(scene, inside, w.rect, w.focused, true)?);
    }
    let view = chrome.map_view(scene, inside, l.view)?;
    drawn.view = Some(view);
    drawn.nodes.push(view);
    // The fold button over the canvas, which hit testing finds first.
    for node in button {
        scene.reorder(node, usize::MAX)?;
    }
    Ok(drawn)
}
