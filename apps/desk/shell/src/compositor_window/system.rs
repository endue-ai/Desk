//! The compositor's system layer (#55, ADR 0160): above every window and below the compositor's own
//! overlays, the system surfaces where the desk's page lays them out. Back to front:
//!
//! - the edge bars' plugin surfaces (the dock), under the page's own bars and pills, as the page
//!   stacks them;
//! - the desk's system surface, the page's pixels: wherever no window lies over a part of another
//!   window that the page draws (`Plan::page`) and no edge bar lies over a window, and, whole, the
//!   box of each part of its system layer it names (`desk_web::sender::PARTS`: the bars' content,
//!   the bottom edge's controls, the arrange strip, Eris, the notices, the settings, the studios,
//!   the overlays), whatever lies under it, so a bar over a window's part is never cut;
//! - the overlays' plugin surfaces (the palette, the first run, a permission prompt), above it all.
//!
//! The pieces never overlap, so no pixel of the page blends twice. A named part takes the pointer
//! everywhere it is drawn, an edge bar's surface included; the rest of the page takes it outside
//! windows, but where an edge bar's surface lies under it, so the bar's plugin hears its own
//! presses; over a window the pointer goes to what the window shows, and the page hears the press
//! there as well (ADR 0150). A window under an edge bar is under it whole: what the page draws of
//! it (its icon, its tools, its own views) is drawn with the window, never above the bar.

use desk_compositor::{Chrome, NodeId, Rect, Scene, SceneError};
use desk_wm::Plan;
use desk_wm::host::{intersect, subtract};

use super::draw::{Drawn, Into, Shown, Sources, page_part, pass, rect, surface};
use super::hosted::Hosted;
use super::report::Layer;

/// The desk's system surface split for drawing: its named parts' boxes (each less the parts before
/// it), by part id, and the rest of the page's own pieces, less every part.
#[derive(Debug, Default, PartialEq)]
pub struct Pieces {
    pub page: Vec<desk_wm::Rect>,
    pub parts: Vec<(String, Vec<desk_wm::Rect>)>,
}

/// Where the desk's system surface is drawn above every window.
pub fn pieces(page: &[desk_wm::Rect], hosted: &Hosted) -> Pieces {
    let mut taken: Vec<desk_wm::Rect> = Vec::new();
    let mut parts = Vec::new();
    let named = hosted
        .report()
        .map(|r| r.parts.as_slice())
        .unwrap_or_default();
    for part in named {
        let Some(at) = part.known() else {
            continue;
        };
        let more = subtract(at, &taken);
        taken.extend(more.iter().copied());
        parts.push((part.id.clone(), more));
    }
    let rest = page.iter().flat_map(|p| subtract(*p, &taken)).collect();
    Pieces { page: rest, parts }
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
    for (id, boxes) in &split.parts {
        for at in boxes {
            page_part(scene, desk, rect(*at), rect(*at), from, &mut drawn.shown)?;
        }
        drawn.parts.push(id.clone());
    }
    plugin_surfaces(scene, chrome, desk, hosted, from, Layer::Overlay, drawn)
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
