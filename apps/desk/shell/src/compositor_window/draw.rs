//! The compositor window's scene from the hosted desk (#81): the wallpaper; every window of the
//! desktop in front, back to front, its frame and title from `Chrome` in the theme in force, each
//! plugin pane its surface's texture at the pane's body (or a card the compositor draws: asleep,
//! stopped, crashed, not painted yet; Not responding over its last frame), what the page draws of
//! the window (its title bar's icon and tools, its own views, split panes' headers), taken from
//! where the page lays the window out and drawn where the window is (#80: a gesture holds it, it
//! glides); the snap preview under the window dragged to an edge; then the system layer (ADR 0160):
//! the edge bars' plugin surfaces, the desk's system surface (the page's bars, Eris, notices, menus,
//! the settings and the studios, its named parts drawn whole above every window) and the overlays'
//! plugin surfaces (the palette, the first run) above them, where the page lays them out. Units are
//! the page's CSS pixels under one group scaled to the window's device pixels, so
//! text is set at the device's size. Every node that shows a surface is answered with the input
//! router's target for it (#56); the compositor's own chrome lets the pointer through to the page,
//! which finds what a press lands on, but for the cards' buttons, which run their commands.

use desk_compositor::glam::{Mat4, Vec2, Vec3};
use desk_compositor::input::Target;
use desk_compositor::{
    Chrome, ChromeTheme, GroupNode, Node, NodeId, Rect, RectNode, Scene, SceneError, SurfaceNode,
    TextureId, Wallpaper,
};

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

/// A card's button: the desk command it runs for its plugin (#39's Wait, Stop and Reload).
#[derive(Clone, Debug, PartialEq)]
pub struct CardButton {
    pub node: NodeId,
    pub command: &'static str,
    pub plugin: String,
}

/// What a scene was drawn with: the nodes that show surfaces, the cards' buttons, the parts of the
/// desk's system surface drawn whole above the windows, and the system layer back to front (the
/// page's own plugin surfaces by plugin, the desk's page as `desk`).
#[derive(Debug, Default)]
pub struct Drawn {
    pub shown: Shown,
    pub buttons: Vec<CardButton>,
    pub parts: Vec<String>,
    pub order: Vec<String>,
}

/// The commands a card's buttons run, in the order the page lists them: Not responding's Wait and
/// Stop, a stopped frame's Reload.
fn commands(state: FrameState) -> &'static [&'static str] {
    match state {
        FrameState::Late => &["desk.frames.wait", "desk.frames.stop"],
        FrameState::Stopped => &["desk.frames.reload"],
        _ => &[],
    }
}

pub(super) fn rect(r: desk_wm::Rect) -> Rect {
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
pub(super) fn page_part(
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
    for w in &plan.windows {
        // Where a drop would snap: under the window dragged there.
        if let Some((at, _)) = hosted.preview().filter(|(_, under)| *under == w.id) {
            let made = chrome.snap_preview(scene, desk, rect(*at))?;
            pass(scene, [made])?;
        }
        window(scene, &mut chrome, desk, w, hosted, from, &mut drawn)?;
    }
    super::system::draw(scene, &mut chrome, desk, plan, hosted, from, &mut drawn)?;
    Ok(drawn)
}

fn window(
    scene: &mut Scene,
    chrome: &mut Chrome,
    desk: NodeId,
    w: &HostWindow,
    hosted: &Hosted,
    from: &Sources,
    drawn: &mut Drawn,
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
    // What the page draws of it (its title bar's icon and tools, its own views, the headers of
    // split panes), from where the page lays it out, at this window's place in the stack.
    for (src, dst) in &w.page_parts {
        page_part(
            scene,
            made.group,
            rect(*src),
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
                title: &pane.title,
            };
            surface(scene, chrome, &into, plugin, hosted, from, drawn)?;
        }
    }
    // The title over the page's title bar, which hides what lies under the window in the page.
    scene.reorder(made.title, usize::MAX)?;
    Ok(())
}

/// Where a plugin's surface goes: a group, the box in it, and the title a card names.
pub(super) struct Into<'a> {
    pub(super) group: NodeId,
    pub(super) to: Rect,
    pub(super) title: &'a str,
}

/// What a plugin pane shows: its surface's last frame, a card over it while it does not answer,
/// or a card instead of it while it has none.
pub(super) fn surface(
    scene: &mut Scene,
    chrome: &mut Chrome,
    into: &Into,
    plugin: &str,
    hosted: &Hosted,
    from: &Sources,
    drawn: &mut Drawn,
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
    // A card lets the pointer through to the page, but for its buttons: each runs its command.
    let mut shows = |c: &Card, chrome: &mut Chrome, scene: &mut Scene, over: bool| {
        let actions: Vec<&str> = c.actions.iter().map(String::as_str).collect();
        let made = chrome.card(
            scene, into.group, into.to, &c.title, &c.line, &actions, over,
        )?;
        let first = made.len().saturating_sub(2 * actions.len());
        let runs = commands(state);
        let mut through = made[..first].to_vec();
        for (i, pair) in made[first..].chunks(2).enumerate() {
            match runs.get(i) {
                Some(command) => drawn.buttons.push(CardButton {
                    node: pair[0],
                    command,
                    plugin: plugin.to_owned(),
                }),
                None => through.push(pair[0]),
            }
            through.extend(pair.get(1));
        }
        pass(scene, through)
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
    drawn.shown.push((node, target(host, Vec2::ZERO)));
    if state == FrameState::Late {
        shows(&card(""), chrome, scene, true)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "draw_tests.rs"]
mod tests;
