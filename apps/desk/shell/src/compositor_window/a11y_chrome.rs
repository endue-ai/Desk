//! The compositor window's chrome for screen readers (#57): what `draw.rs` drew, as
//! `desk_compositor::a11y::DeskChrome`. Every window of the plan back to front, with its title, its
//! title bar, the tools the page draws in it (the page's buttons there, standing in for them), and
//! each pane: a plugin's surface where the scene drew it (its transform from the scene: through the
//! window's group, at the window's scale), a card with its buttons where the scene drew those, or
//! the page's own view; the page under all of it; the surfaces the page lays out over the windows;
//! the spread's dialog while it is open (#54).

use std::collections::HashMap;

use desk_compositor::a11y::{
    ChromeButton, ChromeCard, ChromePane, ChromeSpread, ChromeWindow, DeskChrome, PaneShows,
    Placed, Press, SurfaceTree,
};
use desk_compositor::glam::{DAffine2, DVec2, Mat4};
use desk_compositor::input::Target;
use desk_compositor::{NodeId, Rect, Scene};
use desk_wm::{FrameState, HostWindow};

use super::PAGE;
use super::draw::CardButton;
use super::hosted::Hosted;

/// What the last composed scene showed, in the window's logical pixels: where each surface is drawn
/// (its pixels to the window's) and each plugin's card buttons.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Shown {
    pub placed: HashMap<String, [f64; 6]>,
    pub buttons: HashMap<String, Vec<Rect>>,
    /// The spread while it is open (#54).
    pub spread: Option<ChromeSpread>,
}

fn affine(m: Mat4) -> DAffine2 {
    let (x, y, w) = (
        m.x_axis.as_dvec4(),
        m.y_axis.as_dvec4(),
        m.w_axis.as_dvec4(),
    );
    DAffine2::from_cols(
        x.truncate().truncate(),
        y.truncate().truncate(),
        w.truncate().truncate(),
    )
}

/// What `scene` shows, from the nodes that show surfaces and the cards' buttons, at `scale`.
pub fn shown(
    scene: &Scene,
    nodes: &[(NodeId, Target)],
    buttons: &[CardButton],
    scale: f32,
) -> Shown {
    let mut out = Shown::default();
    let unscale = DAffine2::from_scale(DVec2::splat(1.0 / f64::from(scale.max(0.01))));
    for (node, target) in nodes {
        if target.surface == PAGE || out.placed.contains_key(&target.surface) {
            continue;
        }
        let (Some(world), Some(rect)) = (
            scene.world_transform(*node),
            scene.node(*node).and_then(|n| n.rect()),
        ) else {
            continue;
        };
        let per = target.per_unit.as_dvec2().max(DVec2::splat(1e-6));
        let local = DAffine2::from_translation(rect.min().as_dvec2())
            * DAffine2::from_scale(DVec2::ONE / per)
            * DAffine2::from_translation(-target.origin.as_dvec2());
        let m = unscale * affine(world) * local;
        let [a, b] = m.matrix2.x_axis.to_array();
        let [c, d] = m.matrix2.y_axis.to_array();
        let [e, f] = m.translation.to_array();
        out.placed
            .insert(target.surface.clone(), [a, b, c, d, e, f]);
    }
    for b in buttons {
        if let Some(r) = scene.screen_bounds(b.node) {
            let s = scale.max(0.01);
            let at = Rect::new(r.x / s, r.y / s, r.width / s, r.height / s);
            out.buttons.entry(b.plugin.clone()).or_default().push(at);
        }
    }
    out
}

fn rect(r: desk_wm::Rect) -> Rect {
    Rect::new(r.x as f32, r.y as f32, r.w as f32, r.h as f32)
}

fn middle(r: Rect) -> (f32, f32) {
    (r.x + r.width / 2.0, r.y + r.height / 2.0)
}

/// The page's buttons in window `w`'s title bar (where the page lays it out), each where it is
/// drawn, pressed as the page's node; `above` are the windows over it.
fn tools(w: &HostWindow, above: &[HostWindow], page: Option<&SurfaceTree>) -> Vec<ChromeButton> {
    let Some(page) = page else { return Vec::new() };
    let (dx, dy) = (w.page.x - w.rect.x, w.page.y - w.rect.y);
    let bar = desk_wm::Rect::new(
        w.title_bar.x + dx,
        w.title_bar.y + dy,
        w.title_bar.w,
        w.title_bar.h,
    );
    let inside =
        |r: desk_wm::Rect, x: f64, y: f64| x >= r.x && x < r.right() && y >= r.y && y < r.bottom();
    let mut all = Vec::new();
    for (id, _) in page.walk() {
        let Some(node) = page.node(id) else { continue };
        let (Some(b), Some(name)) = (&node.bounds, &node.name) else {
            continue;
        };
        let (x, y) = (b.x + b.width / 2.0, b.y + b.height / 2.0);
        if node.role != "button" || !inside(bar, x, y) || above.iter().any(|u| inside(u.page, x, y))
        {
            continue;
        }
        let at = Rect::new(
            (b.x - dx) as f32,
            (b.y - dy) as f32,
            b.width as f32,
            b.height as f32,
        );
        all.push(ChromeButton {
            label: name.clone(),
            rect: at,
            press: Press::Node {
                surface: PAGE.to_owned(),
                node: id,
            },
        });
    }
    all
}

/// What pane of plugin `plugin` titled `title` in box `body` shows, as `draw.rs` decides it.
fn pane_shows(hosted: &Hosted, shown: &Shown, plugin: &str, title: &str, body: Rect) -> PaneShows {
    let frame = hosted.frame(plugin);
    let copy = hosted.report().map(|r| r.copy.clone()).unwrap_or_default();
    let state = frame.map_or(FrameState::Live, |f| f.state);
    let host = frame.map(|f| f.host.as_str()).unwrap_or_default();
    let card = |fallback: &str| {
        let given = frame.and_then(|f| f.card.clone());
        let (title, line, actions) = match given {
            Some(c) => (c.title, c.line, c.actions),
            None => (title.to_owned(), fallback.to_owned(), Vec::new()),
        };
        let rects = shown.buttons.get(plugin).cloned().unwrap_or_default();
        let buttons = (actions.into_iter().zip(rects))
            .map(|(label, at)| {
                let (x, y) = middle(at);
                ChromeButton {
                    label,
                    rect: at,
                    press: Press::At(x, y),
                }
            })
            .collect();
        ChromeCard {
            title,
            line,
            rect: body,
            buttons,
        }
    };
    let placed = shown.placed.get(host).map(|t| Placed {
        surface: host.to_owned(),
        transform: *t,
    });
    if state.away() {
        return PaneShows::Card(card(""));
    }
    if hosted.surfaces().dead(host) {
        return PaneShows::Card(card(&copy.crashed));
    }
    match placed {
        None => PaneShows::Card(card(&copy.loading)),
        Some(placed) if state == FrameState::Late => PaneShows::Over(placed, card("")),
        Some(placed) => PaneShows::Surface(placed),
    }
}

/// The desk's chrome as the last scene drew it; `focus` is the surface with the keys.
pub fn chrome(
    hosted: &Hosted,
    shown: &Shown,
    page: Option<&SurfaceTree>,
    scale: f64,
    focus: Option<&str>,
) -> DeskChrome {
    let Some(plan) = hosted.plan() else {
        return DeskChrome::default();
    };
    let windows = (plan.windows.iter().enumerate())
        .map(|(i, w)| {
            let panes = (w.panes.iter())
                .map(|p| {
                    let body = rect(p.body);
                    let shows = match &p.plugin {
                        Some(plugin) => pane_shows(hosted, shown, plugin, &p.title, body),
                        None => PaneShows::Page,
                    };
                    ChromePane {
                        id: p.id.clone(),
                        title: p.title.clone(),
                        rect: rect(p.rect),
                        shows,
                    }
                })
                .collect();
            ChromeWindow {
                id: w.id.clone(),
                title: w.title.clone(),
                rect: rect(w.rect),
                title_bar: rect(w.title_bar),
                focused: w.focused,
                raise: middle(rect(w.title_text())),
                buttons: tools(w, &plan.windows[i + 1..], page),
                panes,
            }
        })
        .collect();
    let placed = (hosted.report().map(|r| r.frames.as_slice())).unwrap_or_default();
    let overlays = (placed.iter())
        .filter(|f| f.place.is_some_and(|p| p.shown))
        .filter_map(|f| {
            let t = shown.placed.get(&f.host)?;
            let placed = Placed {
                surface: f.host.clone(),
                transform: *t,
            };
            Some((f.plugin.clone(), placed))
        })
        .collect();
    DeskChrome {
        label: "endue Desk".into(),
        scale,
        size: (plan.screen.w as f32, plan.screen.h as f32),
        page: Some(("Desk".into(), Placed::at(PAGE, 0.0, 0.0))),
        windows_label: "Windows".into(),
        windows,
        overlays,
        focus: focus.map(str::to_owned),
        spread: shown.spread.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use desk_compositor::glam::Vec2;
    use desk_compositor::{GroupNode, SurfaceNode, TextureId};

    #[test]
    fn a_surface_drawn_in_a_moved_window_at_scale_two_maps_its_pixels_to_the_windows() {
        let mut scene = Scene::new(2560, 1600);
        let desk = scene
            .insert(
                scene.root(),
                GroupNode {
                    transform: Mat4::from_scale((2.0, 2.0, 1.0).into()),
                    opacity: 1.0,
                    clip: None,
                },
            )
            .unwrap();
        let window = scene
            .insert(desk, GroupNode::translated(100.0, 60.0))
            .unwrap();
        let node = scene
            .insert(
                window,
                SurfaceNode::new(Rect::new(1.0, 40.0, 400.0, 300.0), TextureId(1)),
            )
            .unwrap();
        let target = Target {
            surface: "main.e2e-a".into(),
            origin: Vec2::ZERO,
            per_unit: Vec2::ONE,
        };
        let shown = shown(&scene, &[(node, target)], &[], 2.0);
        assert_eq!(
            shown.placed["main.e2e-a"],
            [1.0, 0.0, 0.0, 1.0, 101.0, 100.0]
        );
    }
}
