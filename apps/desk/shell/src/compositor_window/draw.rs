//! The compositor window's scene from the hosted desk (#81): the wallpaper; every window of the
//! desktop in front, back to front, its frame and title from `Chrome` in the theme in force, each
//! plugin pane its surface's texture at the pane's body (or a card the compositor draws: asleep,
//! stopped, crashed, not painted yet; Not responding over its last frame), what the page draws of
//! the window (its title bar's icon and tools, its own views, split panes' headers) at the window's
//! place; then the plugin surfaces the page lays out itself (overlays, edge bars) and the page's
//! system layer (bars, Eris, menus) above every window. Units are the page's CSS pixels under one
//! group scaled to the window's device pixels, so text is set at the device's size. Every node that
//! shows a surface is answered with the input router's target for it (#56); the compositor's own
//! chrome lets the pointer through to the page, whose window manager still takes it (until #80).

use desk_compositor::glam::{Mat4, Vec2, Vec3};
use desk_compositor::input::Target;
use desk_compositor::{
    Chrome, ChromeTheme, GroupNode, Node, NodeId, Rect, RectNode, Scene, SceneError, SurfaceNode,
    TextureId, Wallpaper,
};
use desk_wm::host::{intersect, subtract};
use desk_wm::{FrameState, HostWindow};

use super::PAGE;
use super::hosted::Hosted;
use super::report::Card;

/// A texture the compositor holds and its size in pixels.
pub type Texture = (TextureId, (u32, u32));

/// What the scene is drawn from besides the hosted desk.
pub struct Sources<'a> {
    pub scale: f32,
    /// The shell page's texture.
    pub page: Option<Texture>,
    /// A surface's texture, by surface host.
    pub surface: &'a dyn Fn(&str) -> Option<Texture>,
}

/// The nodes that show a surface, each with what it shows for input.
pub type Shown = Vec<(NodeId, Target)>;

fn rect(r: desk_wm::Rect) -> Rect {
    Rect::new(r.x as f32, r.y as f32, r.w as f32, r.h as f32)
}

/// A surface's own logical pixels from a node's top left at `origin`: one per CSS pixel.
fn target(surface: &str, origin: Vec2) -> Target {
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
fn page_part(
    scene: &mut Scene,
    parent: NodeId,
    at: Rect,
    to: Rect,
    from: &Sources,
    shown: &mut Shown,
) -> Result<(), SceneError> {
    let Some((id, (tw, th))) = from.page else {
        return Ok(());
    };
    let (s, tw, th) = (from.scale, tw.max(1) as f32, th.max(1) as f32);
    let uv = Rect::new(
        at.x * s / tw,
        at.y * s / th,
        at.width * s / tw,
        at.height * s / th,
    );
    let node = scene.insert(
        parent,
        SurfaceNode {
            uv,
            ..SurfaceNode::new(to, id)
        },
    )?;
    shown.push((node, target(PAGE, Vec2::new(at.x, at.y))));
    Ok(())
}

/// The compositor's own parts let the pointer through, to the page under them.
fn pass(scene: &mut Scene, nodes: impl IntoIterator<Item = NodeId>) -> Result<(), SceneError> {
    for id in nodes {
        if let Some(node) = scene.node(id).cloned() {
            scene.set(id, node.with_hit(false))?;
        }
    }
    Ok(())
}

/// Fill `scene` again from `hosted` in `theme`; the nodes that show a surface.
pub fn draw(
    scene: &mut Scene,
    theme: &ChromeTheme,
    hosted: &Hosted,
    from: &Sources,
) -> Result<Shown, SceneError> {
    let root = scene.root();
    for child in scene.children(root).to_vec() {
        scene.remove(child)?;
    }
    scene.set_wallpaper(Wallpaper::Solid(theme.wallpaper));
    let mut shown = Shown::new();
    let Some(plan) = hosted.plan() else {
        return Ok(shown);
    };
    let s = from.scale;
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
        shown.push((node, target(PAGE, Vec2::ZERO)));
    }
    let mut chrome = Chrome::new(theme.clone());
    for w in &plan.windows {
        window(scene, &mut chrome, desk, w, hosted, from, &mut shown)?;
    }
    page_surfaces(scene, &mut chrome, desk, hosted, from, &mut shown)?;
    // Above every window the page is seen, but over a window the pointer goes to what the window
    // shows (its surface, or the page's part of it, which hears the press there as well).
    let windows: Vec<desk_wm::Rect> = plan.windows.iter().map(|w| w.rect).collect();
    for piece in &plan.page {
        for open in subtract(*piece, &windows) {
            page_part(scene, desk, rect(open), rect(open), from, &mut shown)?;
        }
        let over = windows.iter().filter_map(|w| intersect(*piece, *w));
        for part in over.map(rect) {
            let mut seen = Shown::new();
            page_part(scene, desk, part, part, from, &mut seen)?;
            pass(scene, seen.into_iter().map(|(node, _)| node))?;
        }
    }
    Ok(shown)
}

/// The page's own plugin surfaces (overlays, edge bars), where it lays them out: above the windows,
/// under the page's system layer (its bars and pills float above an edge bar, as in the page).
fn page_surfaces(
    scene: &mut Scene,
    chrome: &mut Chrome,
    desk: NodeId,
    hosted: &Hosted,
    from: &Sources,
    shown: &mut Shown,
) -> Result<(), SceneError> {
    let placed = (hosted.report().map(|r| r.frames.as_slice())).unwrap_or_default();
    for frame in placed {
        let Some(p) = frame.place.filter(|p| p.shown) else {
            continue;
        };
        let at = Rect::new(p.x as f32, p.y as f32, p.width as f32, p.height as f32);
        let into = Into {
            group: desk,
            to: at,
            title: &frame.plugin,
        };
        surface(scene, chrome, &into, &frame.plugin, hosted, from, shown)?;
    }
    Ok(())
}

fn window(
    scene: &mut Scene,
    chrome: &mut Chrome,
    desk: NodeId,
    w: &HostWindow,
    hosted: &Hosted,
    from: &Sources,
    shown: &mut Shown,
) -> Result<(), SceneError> {
    let at = rect(w.rect);
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
    let local = |r: desk_wm::Rect| rect(r).translate(-at.min());
    let bar = w.title_bar;
    page_part(scene, made.group, rect(bar), local(bar), from, shown)?;
    for divider in &w.dividers {
        let line = RectNode::new(local(*divider), chrome.theme().window.divider);
        scene.insert(made.group, Node::from(line).with_hit(false))?;
    }
    for pane in &w.panes {
        // What the page draws in it (its own view, the header of a split pane), at this window's
        // place in the stack.
        for part in pane.drawn_by_page() {
            page_part(scene, made.group, rect(part), local(part), from, shown)?;
        }
        if let Some(plugin) = &pane.plugin {
            let into = Into {
                group: made.group,
                to: local(pane.body),
                title: &pane.title,
            };
            surface(scene, chrome, &into, plugin, hosted, from, shown)?;
        }
    }
    // The title over the page's title bar, which hides what lies under the window in the page.
    scene.reorder(made.title, usize::MAX)?;
    Ok(())
}

/// Where a plugin's surface goes: a group, the box in it, and the title a card names.
struct Into<'a> {
    group: NodeId,
    to: Rect,
    title: &'a str,
}

/// What a plugin pane shows: its surface's last frame, a card over it while it does not answer,
/// or a card instead of it while it has none.
fn surface(
    scene: &mut Scene,
    chrome: &mut Chrome,
    into: &Into,
    plugin: &str,
    hosted: &Hosted,
    from: &Sources,
    shown: &mut Shown,
) -> Result<(), SceneError> {
    let frame = hosted.frame(plugin);
    let copy = hosted.report().map(|r| r.copy.clone()).unwrap_or_default();
    let state = frame.map_or(FrameState::Live, |f| f.state);
    let host = frame.map(|f| f.host.as_str()).unwrap_or_default();
    let card = |fallback: &str| {
        let given = frame.and_then(|f| f.card.clone());
        given.unwrap_or_else(|| Card {
            title: into.title.to_owned(),
            line: fallback.to_owned(),
            actions: Vec::new(),
        })
    };
    let shows = |c: &Card, chrome: &mut Chrome, scene: &mut Scene, over: bool| {
        let actions: Vec<&str> = c.actions.iter().map(String::as_str).collect();
        let made = chrome.card(
            scene, into.group, into.to, &c.title, &c.line, &actions, over,
        )?;
        pass(scene, made)
    };
    if state.away() {
        return shows(&card(""), chrome, scene, false);
    }
    if hosted.surfaces().dead(host) {
        return shows(&card(&copy.crashed), chrome, scene, false);
    }
    let Some(texture) = (from.surface)(host) else {
        return shows(&card(&copy.loading), chrome, scene, false);
    };
    let node = scene.insert(into.group, sampled(into.to, texture, from.scale))?;
    shown.push((node, target(host, Vec2::ZERO)));
    if state == FrameState::Late {
        shows(&card(""), chrome, scene, true)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "draw_tests.rs"]
mod tests;
