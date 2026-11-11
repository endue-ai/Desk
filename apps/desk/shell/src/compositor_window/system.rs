//! The compositor's system layer (#55, ADR 0160): above every window and below the compositor's own
//! overlays, the system surfaces where the desk's page lays them out. Back to front:
//!
//! - the edge bars' plugin surfaces (the dock), under the page's own bars and pills, as the page
//!   stacks them;
//! - the desk's system surface, the page's pixels: wherever no window lies over a part of another
//!   window that the page draws (`Plan::page`) and no edge bar lies over a window, and, whole, the
//!   box of each part of its system layer it names (`desk_web::sender::PARTS`: the bars' content,
//!   the bottom edge's controls, the arrange strip, Eris, the notices), whatever lies under it, so
//!   a bar over a window's part is never cut;
//! - the canvas map (`draw_map.rs`), over the bars;
//! - each modal's scrim the page has open: the theme's dialog scrim over everything drawn so far,
//!   every window, the dock and the map included; the page paints none, as it could dim only its
//!   own pixels (ADR XXXX);
//! - what the desk opens over all that, whole: the settings, the studios, the dialogs, menus, hover
//!   cards and popovers (the parts of `Level::Front`);
//! - the overlays' plugin surfaces (the palette, the first run, a permission prompt), above it all.
//!
//! The pieces never overlap, so no pixel of the page blends twice. A named part takes the pointer
//! everywhere it is drawn, an edge bar's surface included, and so does a scrim, for the page: a
//! press outside a modal is the modal's, never a window's; the rest of the page takes it outside
//! windows, but where an edge bar's surface lies under it, so the bar's plugin hears its own
//! presses; over a window the pointer goes to what the window shows, and the page hears the press
//! there as well (ADR 0150). A window under an edge bar is under it whole: what the page draws of
//! it (its icon, its tools, its own views) is drawn with the window, never above the bar.

use desk_compositor::glam::Vec2;
use desk_compositor::{Chrome, NodeId, Rect, RectNode, Scene, SceneError};
use desk_web::sender::Level;
use desk_wm::Plan;
use desk_wm::host::{intersect, subtract};

use super::draw::{Drawn, Into, Shown, Sources, page_part, pass, rect, surface, target};
use super::hosted::Hosted;
use super::report::Layer;

/// The desk's system surface split for drawing: its named parts' boxes (each less those of the
/// parts before it, the front's first), by part id in the page's order, the rest of the page's own
/// pieces, less every part, and the boxes of the modals' scrims, which the compositor fills over
/// whatever lies under them.
#[derive(Debug, Default, PartialEq)]
pub struct Pieces {
    pub page: Vec<desk_wm::Rect>,
    pub parts: Vec<(String, Vec<desk_wm::Rect>)>,
    pub scrims: Vec<desk_wm::Rect>,
}

/// Where a part `id` goes among what the compositor draws of its own.
fn level(id: &str) -> Level {
    desk_web::sender::part(id).map_or(Level::Bar, |p| p.level)
}

/// Where the desk's system surface is drawn above every window. What the desk opens over its
/// bars lies above them in the page too: where a dialog's box meets a bar's (Eris's figure under
/// the desktops' overview), the page's pixels there are the dialog's, drawn with it, above the
/// map and the scrims.
pub fn pieces(page: &[desk_wm::Rect], hosted: &Hosted) -> Pieces {
    let named = hosted
        .report()
        .map(|r| r.parts.as_slice())
        .unwrap_or_default();
    let mut known: Vec<(usize, &str, desk_wm::Rect)> = (named.iter().enumerate())
        .filter_map(|(i, p)| Some((i, p.id.as_str(), p.known()?)))
        .collect();
    // No pixel of the page's: the compositor's fill.
    let scrims = (known.iter())
        .filter(|(_, id, _)| level(id) == Level::Scrim)
        .map(|(.., at)| *at)
        .collect();
    known.retain(|(_, id, _)| level(id) != Level::Scrim);
    // The front first, each in the page's order, which the parts keep.
    known.sort_by_key(|(i, id, _)| (level(id) != Level::Front, *i));
    let mut taken: Vec<desk_wm::Rect> = Vec::new();
    let mut parts: Vec<(usize, String, Vec<desk_wm::Rect>)> = Vec::new();
    for (i, id, at) in known {
        let more = subtract(at, &taken);
        taken.extend(more.iter().copied());
        parts.push((i, id.to_owned(), more));
    }
    parts.sort_by_key(|(i, ..)| *i);
    let rest = page.iter().flat_map(|p| subtract(*p, &taken)).collect();
    Pieces {
        page: rest,
        parts: parts
            .into_iter()
            .map(|(_, id, boxes)| (id, boxes))
            .collect(),
        scrims,
    }
}

/// The boxes of the edge bars' plugin surfaces the page shows.
fn edges(hosted: &Hosted) -> Vec<desk_wm::Rect> {
    let frames = hosted
        .report()
        .map(|r| r.frames.as_slice())
        .unwrap_or_default();
    (frames.iter())
        .filter_map(|f| f.place.filter(|p| p.shown && p.layer == Layer::Edge))
        .map(|p| desk_wm::Rect::new(p.x, p.y, p.width, p.height))
        .collect()
}

/// Draw the system layer into `desk` above the windows of `plan`.
pub fn draw(
    scene: &mut Scene,
    chrome: &mut Chrome,
    desk: NodeId,
    plan: &Plan,
    hosted: &Hosted,
    from: &Sources,
    drawn: &mut Drawn,
) -> Result<(), SceneError> {
    plugin_surfaces(scene, chrome, desk, hosted, from, Layer::Edge, drawn)?;
    drawn.order.push(super::PAGE.to_owned());
    let split = pieces(&plan.page, hosted);
    let windows: Vec<desk_wm::Rect> = plan.windows.iter().map(|w| w.rect).collect();
    let bars = edges(hosted);
    for piece in &split.page {
        for open in subtract(*piece, &windows) {
            for clear in subtract(open, &bars) {
                page_part(
                    scene,
                    desk,
                    rect(clear),
                    rect(clear),
                    from,
                    &mut drawn.shown,
                )?;
            }
            for over in bars.iter().filter_map(|b| intersect(open, *b)) {
                unheard(scene, desk, over, from)?;
            }
        }
        // What the page draws of a window stays with its window, under the edge bars: drawn over
        // a bar, a window's icon and tools would show where the bar's plugin hears the press.
        for over in windows.iter().filter_map(|w| intersect(*piece, *w)) {
            for clear in subtract(over, &bars) {
                unheard(scene, desk, clear, from)?;
            }
        }
    }
    let (front, under): (Vec<_>, Vec<_>) =
        (split.parts.iter()).partition(|(id, _)| level(id) == Level::Front);
    for (id, boxes) in under {
        whole(scene, desk, id, boxes, from, drawn)?;
    }
    if let Some(map) = &from.map {
        drawn.map = Some(super::draw_map::draw(scene, chrome, desk, map)?);
    }
    for at in &split.scrims {
        scrim(scene, chrome, desk, *at, &mut drawn.shown)?;
        drawn.parts.push("desk.scrim".to_owned());
    }
    for (id, boxes) in front {
        whole(scene, desk, id, boxes, from, drawn)?;
    }
    plugin_surfaces(scene, chrome, desk, hosted, from, Layer::Overlay, drawn)
}

/// The page's pixels of part `id`, in its boxes.
fn whole(
    scene: &mut Scene,
    desk: NodeId,
    id: &str,
    boxes: &[desk_wm::Rect],
    from: &Sources,
    drawn: &mut Drawn,
) -> Result<(), SceneError> {
    for at in boxes {
        page_part(scene, desk, rect(*at), rect(*at), from, &mut drawn.shown)?;
    }
    drawn.parts.push(id.to_owned());
    Ok(())
}

/// A modal's scrim at `at`: the theme's dialog scrim (`dialogScrim`, the spread's too) over
/// everything drawn so far. The page hears the pointer on it, where its own scrim lies unpainted:
/// a press outside the modal is the modal's.
fn scrim(
    scene: &mut Scene,
    chrome: &Chrome,
    desk: NodeId,
    at: desk_wm::Rect,
    shown: &mut Shown,
) -> Result<(), SceneError> {
    let fill = RectNode::new(rect(at), chrome.theme().spread.scrim);
    let node = scene.insert(desk, fill)?;
    shown.push((
        node,
        target(super::PAGE, Vec2::new(at.x as f32, at.y as f32)),
    ));
    Ok(())
}

/// The page's pixels at `at`, seen but letting the pointer through to what lies under them.
fn unheard(
    scene: &mut Scene,
    desk: NodeId,
    at: desk_wm::Rect,
    from: &Sources,
) -> Result<(), SceneError> {
    let mut seen = Shown::new();
    page_part(scene, desk, rect(at), rect(at), from, &mut seen)?;
    pass(scene, seen.into_iter().map(|(node, _)| node))
}

/// The page's own plugin surfaces of `layer`, where it lays them out (the spread draws them under
/// its scrim too, #54).
pub(super) fn plugin_surfaces(
    scene: &mut Scene,
    chrome: &mut Chrome,
    desk: NodeId,
    hosted: &Hosted,
    from: &Sources,
    layer: Layer,
    drawn: &mut Drawn,
) -> Result<(), SceneError> {
    let placed = (hosted.report().map(|r| r.frames.as_slice())).unwrap_or_default();
    for frame in placed {
        let Some(p) = frame.place.filter(|p| p.shown && p.layer == layer) else {
            continue;
        };
        let at = Rect::new(p.x as f32, p.y as f32, p.width as f32, p.height as f32);
        let into = Into {
            group: desk,
            to: at,
            title: &frame.plugin,
        };
        surface(scene, chrome, &into, &frame.plugin, hosted, from, drawn)?;
        drawn.order.push(frame.plugin.clone());
    }
    Ok(())
}

#[cfg(test)]
#[path = "system_tests.rs"]
mod tests;
