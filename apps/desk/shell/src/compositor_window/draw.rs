//! The compositor window's scene from the hosted desk (#81): the wallpaper; every window of the
//! desktop in front, back to front, its frame and title from `Chrome` in the theme in force, each
//! plugin pane its surface's texture at the pane's body (or a card the compositor draws: asleep,
//! stopped, crashed, not painted yet; Not responding over its last frame), what the page draws of
//! the window (its title bar's icon and tools, its own views, split panes' headers), taken from
//! where the page lays the window out and drawn where the window is (#80: a gesture holds it, it
//! glides); the snap preview under the window dragged to an edge; then the system layer (ADR 0160):
//! the edge bars' plugin surfaces, the desk's system surface (the page's bars, Eris, notices, its
//! named parts drawn whole above every window), the canvas map when it shows (`draw_map.rs`, #54),
//! a modal's scrim, what the desk opens over them (the settings, the studios, dialogs, menus) and
//! the overlays' plugin surfaces (the palette, the first run) above it all, where the page lays
//! them out (`system.rs`). Units are the page's CSS pixels under one group scaled to the window's
//! device pixels, so text is set at the device's size. Every node that shows a surface is answered
//! with the input router's target for it (#56); the compositor's own chrome lets the pointer
//! through to the page, which finds what a press lands on, but for the cards' buttons, which run
//! their commands. While the spread is open every window is a card at its pose instead
//! (`draw_spread.rs`). A surface's open popup widget (a select's list, a picker) is drawn whole: a
//! window's above every window and under the system layer, a system surface's over its layer, the
//! page's over everything (`draw_popup.rs`).

use desk_compositor::a11y::ChromeSpread;
use desk_compositor::glam::{Mat4, Vec2, Vec3};
use desk_compositor::input::Target;
use desk_compositor::stage::stage_projection;
use desk_compositor::{
    Chrome, ChromeTheme, GroupNode, Node, NodeId, Projection, Rect, RectNode, Scene, SceneError,
    SurfaceNode, TextureId, Wallpaper,
};
use desk_wm::HostWindow;

use super::PAGE;
use super::draw_map::{MapDrawn, MapSource};
pub(super) use super::draw_pane::{Into, surface};
use super::hosted::Hosted;
use crate::web_host::window_pages;

/// A texture the compositor holds and its size in pixels.
pub type Texture = (TextureId, (u32, u32));

/// What the scene is drawn from besides the hosted desk.
pub struct Sources<'a> {
    pub scale: f32,
    /// The shell page's texture.
    pub page: Option<Texture>,
    /// A surface's texture, by surface host.
    pub surface: &'a dyn Fn(&str) -> Option<Texture>,
    /// A surface's open popup widget, by surface host (#156, `draw_popup.rs`).
    pub popup: &'a dyn Fn(&str) -> Option<super::draw_popup::Popup>,
    /// The spread while it is open, and the window manager's time (#54).
    pub spread: Option<(&'a desk_wm::Spread, f64)>,
    /// The canvas map while it shows (#54).
    pub map: Option<MapSource<'a>>,
}

/// The nodes that show a surface, each with what it shows for input.
pub type Shown = Vec<(NodeId, Target)>;

/// A card's button: the desk command it runs for its plugin (#39's Wait, Stop and Reload).
#[derive(Clone, Debug, PartialEq)]
pub struct CardButton {
    pub node: NodeId,
    pub command: &'static str,
    pub plugin: String,
}

/// What a scene was drawn with: the nodes that show surfaces, the cards' buttons, the parts of the
/// desk's system surface drawn whole above the windows, and the system layer back to front (the
/// page's own plugin surfaces by plugin, the desk's page as `desk`); and the spread's and the canvas
/// map's nodes.
#[derive(Debug, Default)]
pub struct Drawn {
    pub shown: Shown,
    pub buttons: Vec<CardButton>,
    pub parts: Vec<String>,
    pub order: Vec<String>,
    /// Each spread card's node a hit test finds, and its window.
    pub cards: Vec<(NodeId, String)>,
    /// The spread's bar.
    pub bar: Vec<NodeId>,
    /// The spread for assistive technology.
    pub spread: Option<ChromeSpread>,
    pub map: Option<MapDrawn>,
    /// Each plugin surface drawn live, by host, and where (the web host's screens and the popups
    /// over them, `draw_popup::flush`); how many of them had their popups drawn; and where those
    /// are, by host.
    pub placed: Vec<(String, Rect)>,
    pub flushed: usize,
    pub popups: Vec<(String, desk_wm::Rect)>,
    /// Each plugin surface drawn in a window drawn from its own page, and that page (ADR 0201).
    pub pages: Vec<(String, String)>,
}

pub(super) fn rect(r: desk_wm::Rect) -> Rect {
    Rect::new(r.x as f32, r.y as f32, r.w as f32, r.h as f32)
}

/// A surface's own logical pixels from a node's top left at `origin`: one per CSS pixel.
pub(super) fn target(surface: &str, origin: Vec2) -> Target {
    Target {
        surface: surface.to_owned(),
        origin,
        per_unit: Vec2::ONE,
    }
}

/// The part of `texture` that covers `at` (CSS px) from its top left: never stretched; past its
/// edge nothing is drawn (`lifecycle.md`: an older frame is cropped or padded).
pub fn sampled(at: Rect, (id, (tw, th)): Texture, scale: f32) -> SurfaceNode {
    let (tw, th) = (tw.max(1) as f32, th.max(1) as f32);
    let w = at.width.min(tw / scale).max(0.0);
    let h = at.height.min(th / scale).max(0.0);
    SurfaceNode {
        uv: Rect::new(0.0, 0.0, w * scale / tw, h * scale / th),
        ..SurfaceNode::new(Rect::new(at.x, at.y, w, h), id)
    }
}

/// The page's pixels at `at` (page CSS px), drawn at `to` in `parent`; the page hears the pointer
/// there at its own point.
pub(super) fn page_part(
    scene: &mut Scene,
    parent: NodeId,
    at: Rect,
    to: Rect,
    from: &Sources,
    shown: &mut Shown,
) -> Result<(), SceneError> {
    let heard = Vec2::new(at.x, at.y);
    page_part_heard(scene, parent, (at, heard), to, from, shown)
}

/// The same, the page hearing the pointer from `heard` rather than from `at`'s corner: a window's
/// part the picture shows at `at` while the DOM has it already elsewhere. Only what the page's
/// texture holds of `at` is drawn: past its edge (a texture not grown to the window's new size
/// yet, a window laid out past the page) the sampler would repeat the edge's pixels in stripes.
pub(super) fn page_part_heard(
    scene: &mut Scene,
    parent: NodeId,
    (at, heard): (Rect, Vec2),
    to: Rect,
    from: &Sources,
    shown: &mut Shown,
) -> Result<(), SceneError> {
    let Some((id, (tw, th))) = from.page else {
        return Ok(());
    };
    let (s, tw, th) = (from.scale, tw.max(1) as f32, th.max(1) as f32);
    let (x0, y0) = (at.x.max(0.0), at.y.max(0.0));
    let (x1, y1) = (
        (at.x + at.width).min(tw / s),
        (at.y + at.height).min(th / s),
    );
    if x1 <= x0 || y1 <= y0 || at.width <= 0.0 || at.height <= 0.0 {
        return Ok(());
    }
    let (kx, ky) = (to.width / at.width, to.height / at.height);
    let cut = Vec2::new(x0 - at.x, y0 - at.y);
    let to = Rect::new(
        to.x + cut.x * kx,
        to.y + cut.y * ky,
        (x1 - x0) * kx,
        (y1 - y0) * ky,
    );
    let uv = Rect::new(
        x0 * s / tw,
        y0 * s / th,
        (x1 - x0) * s / tw,
        (y1 - y0) * s / th,
    );
    let node = scene.insert(
        parent,
        SurfaceNode {
            uv,
            ..SurfaceNode::new(to, id)
        },
    )?;
    shown.push((node, target(PAGE, heard + cut)));
    Ok(())
}

/// The compositor's own parts let the pointer through, to the page under them.
pub(super) fn pass(
    scene: &mut Scene,
    nodes: impl IntoIterator<Item = NodeId>,
) -> Result<(), SceneError> {
    for id in nodes {
        if let Some(node) = scene.node(id).cloned() {
            scene.set(id, node.with_hit(false))?;
        }
    }
    Ok(())
}

/// Fill `scene` again from `hosted` in `theme`; the nodes that show a surface and the buttons.
pub fn draw(
    scene: &mut Scene,
    theme: &ChromeTheme,
    hosted: &Hosted,
    from: &Sources,
) -> Result<Drawn, SceneError> {
    let root = scene.root();
    for child in scene.children(root).to_vec() {
        scene.remove(child)?;
    }
    scene.set_wallpaper(Wallpaper::Solid(theme.wallpaper));
    let mut drawn = Drawn::default();
    let Some(plan) = hosted.plan() else {
        return Ok(drawn);
    };
    let s = from.scale;
    let lens = match from.spread {
        Some(_) => stage_projection(plan.screen.h as f32),
        None => Projection::Orthographic,
    };
    scene.set_projection(lens);
    let desk = scene.insert(
        root,
        GroupNode {
            transform: Mat4::from_scale(Vec3::new(s, s, 1.0)),
            opacity: 1.0,
            clip: None,
        },
    )?;
    // Under everything, unseen: the page takes the pointer wherever no surface is above it.
    let whole = Rect::new(0.0, 0.0, plan.screen.w as f32, plan.screen.h as f32);
    if let Some((id, _)) = from.page {
        let under = SurfaceNode {
            opacity: 0.0,
            ..SurfaceNode::new(whole, id)
        };
        let node = scene.insert(desk, under)?;
        drawn.shown.push((node, target(PAGE, Vec2::ZERO)));
    }
    let mut chrome = Chrome::new(theme.clone());
    if let Some((spread, now)) = from.spread {
        let mut on = super::draw_spread::Stage {
            scene,
            chrome: &mut chrome,
            desk,
            hosted,
            from,
            drawn: &mut drawn,
        };
        on.draw(spread, now)?;
        return Ok(drawn);
    }
    for w in &plan.windows {
        // Where a drop would snap: under the window dragged there.
        if let Some((at, _)) = hosted.preview().filter(|(_, under)| *under == w.id) {
            let made = chrome.snap_preview(scene, desk, rect(*at))?;
            pass(scene, [made])?;
        }
        window(scene, &mut chrome, desk, w, hosted, from, &mut drawn)?;
    }
    // The windows' popups, whole, above every window and under the system layer.
    super::draw_popup::flush(scene, desk, whole, from, &mut drawn)?;
    // The canvas map with it, over the bars and under what the desk opens over them.
    super::system::draw(scene, &mut chrome, desk, plan, hosted, from, &mut drawn)?;
    // The page's own popup (a list in the settings, say) over everything it lays out.
    super::draw_popup::over(scene, desk, (whole, whole), PAGE, from, &mut drawn.shown)?;
    Ok(drawn)
}

pub(super) fn window(
    scene: &mut Scene,
    chrome: &mut Chrome,
    desk: NodeId,
    w: &HostWindow,
    hosted: &Hosted,
    from: &Sources,
    drawn: &mut Drawn,
) -> Result<(), SceneError> {
    // At rest on whole device pixels; on its way where it is (#250, `draw_pixels.rs`).
    let moving = hosted.on_its_way(&w.id);
    let laid = rect(w.rect);
    let at = if moving {
        laid
    } else {
        rect(pixels::at_rest(w.rect, from.scale))
    };
    let made = chrome.window(scene, desk, at, &w.title, None, w.focused)?;
    // The title sits between the icon and the tools the page draws, clear of the top chips.
    let (start, end) = w.title_insets();
    chrome.clear_title(scene, &made, start as f32, end as f32)?;
    pass(
        scene,
        [made.frame, made.divider, made.title]
            .into_iter()
            .chain(made.subtitle),
    )?;
    let local = |r: desk_wm::Rect| rect(r).translate(-laid.min());
    // Its own page, once it painted (ADR 0201): its title bar's icon and tools, its own views and
    // the headers of split panes from the window's own texture, at the window's place, and the
    // pointer on it to that page; nothing of the window from the desk's page.
    let own = window_pages::surface_of(&w.id);
    let paged = (from.surface)(&own);
    if let Some(texture) = paged {
        let whole = Rect::new(0.0, 0.0, at.width, at.height);
        let node = scene.insert(made.group, sampled(whole, texture, from.scale))?;
        drawn.shown.push((node, target(&own, Vec2::ZERO)));
        drawn.placed.push((own, at));
    }
    // Else what the page draws of it, from where the page's picture shows it, at this window's
    // place in the stack; the pointer on it goes to where the page's DOM has it.
    let dom = Vec2::new((w.heard.x - w.page.x) as f32, (w.heard.y - w.page.y) as f32);
    let parts = if paged.is_some() {
        &[][..]
    } else {
        &w.page_parts[..]
    };
    for (src, dst) in parts {
        let src = rect(*src);
        page_part_heard(
            scene,
            made.group,
            (src, src.min() + dom),
            local(*dst),
            from,
            &mut drawn.shown,
        )?;
    }
    for divider in &w.dividers {
        let line = RectNode::new(local(*divider), chrome.theme().window.divider);
        scene.insert(made.group, Node::from(line).with_hit(false))?;
    }
    for pane in &w.panes {
        if let Some(plugin) = &pane.plugin {
            let into = Into {
                group: made.group,
                to: local(pane.body),
                at: at.min(),
                title: &pane.title,
            };
            surface(scene, chrome, &into, plugin, hosted, from, drawn)?;
            // Its window's page hears a press on it too: its DOM finds the pane and its window.
            if paged.is_some()
                && let Some(frame) = hosted.frame(plugin)
            {
                let own = window_pages::surface_of(&w.id);
                drawn.pages.push((frame.host.clone(), own));
            }
        }
    }
    // Its content inside the frame's rounded corners; filtered while it is on its way.
    let radius = chrome.theme().window.radius;
    pixels::inside_corners(scene, made.group, (at.width, at.height), radius)?;
    if moving {
        pixels::on_its_way(scene, made.group)?;
    }
    // The title over the page's title bar, which hides what lies under the window in the page.
    scene.reorder(made.title, usize::MAX)?;
    Ok(())
}

#[path = "draw_pixels.rs"]
pub(super) mod pixels;

#[cfg(test)]
#[path = "draw_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "draw_cost_tests.rs"]
mod cost_tests;
