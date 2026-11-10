//! The spread's scene (#54, ADR 0116): what the page shows outside the windows and its own
//! surfaces, under a scrim; every window of the desktop in front as a card at its pose on the
//! stage, under the stage's perspective, whole (its chrome, what the page draws of it, its live
//! surfaces, a sleeping one's last frame greyed), in the spread's paint order, the selected one
//! ringed; and the filter field with the count and the hint above everything. A card's contents
//! let the pointer through to one transparent node over the window, which names its window to the
//! spread's pointer (`spread.rs`); a card filtered out has none.

use desk_compositor::a11y::{ChromeOption, ChromeSpread};
use desk_compositor::stage::{pose_transform, stage_transform};
use desk_compositor::{
    Chrome, Color, GroupNode, Node, NodeId, Rect, RectNode, Scene, SceneError, SpreadText,
};
use desk_wm::host::subtract;
use desk_wm::{Spread, SpreadWindow};

use super::draw::{Drawn, Shown, Sources, page_part, pass, rect, window};
use super::hosted::Hosted;
use super::report::Layer;
use super::report::SpreadCopy;
use super::system::{pieces, plugin_surfaces};

/// What draws the spread: the scene and its chrome, the flat desk group, and what it is drawn from.
pub struct Stage<'a, 'b> {
    pub scene: &'a mut Scene,
    pub chrome: &'a mut Chrome,
    pub desk: NodeId,
    pub hosted: &'a Hosted,
    pub from: &'a Sources<'b>,
    pub drawn: &'a mut Drawn,
}

/// `text` with `{name}` replaced by each value.
pub fn fill(text: &str, vars: &[(&str, String)]) -> String {
    vars.iter().fold(text.to_owned(), |t, (name, value)| {
        t.replace(&format!("{{{name}}}"), value)
    })
}

/// The page's copy, or the desk's English where it has none.
fn said<'a>(given: &'a str, english: &'a str) -> &'a str {
    if given.is_empty() { english } else { given }
}

impl Stage<'_, '_> {
    /// The spread as it is drawn at the window manager's time `now`.
    pub fn draw(&mut self, spread: &Spread, now: f64) -> Result<(), SceneError> {
        let Some(plan) = self.hosted.plan() else {
            return Ok(());
        };
        let s = self.from.scale;
        let (w, h) = (plan.screen.w as f32, plan.screen.h as f32);
        let whole = Rect::new(0.0, 0.0, w, h);
        // Under the scrim, as the system layer stacks it (ADR 0160): the edge bars' surfaces, the
        // page outside the windows and its named parts whole (its bars, Eris), and the overlays.
        // Nothing of it takes the pointer while the spread is open.
        let windows: Vec<desk_wm::Rect> = plan.windows.iter().map(|w| w.rect).collect();
        let split = pieces(&plan.page, self.hosted);
        let mut own = Drawn::default();
        let (scene, chrome, desk, hosted, from) = (
            &mut *self.scene,
            &mut *self.chrome,
            self.desk,
            self.hosted,
            self.from,
        );
        plugin_surfaces(scene, chrome, desk, hosted, from, Layer::Edge, &mut own)?;
        let mut under = Shown::new();
        let open = split
            .page
            .iter()
            .flat_map(|piece| subtract(*piece, &windows));
        let named = split
            .parts
            .iter()
            .flat_map(|(_, boxes)| boxes.iter().copied());
        for at in open.chain(named).collect::<Vec<_>>() {
            page_part(scene, desk, rect(at), rect(at), from, &mut under)?;
        }
        plugin_surfaces(scene, chrome, desk, hosted, from, Layer::Overlay, &mut own)?;
        let nodes = under.into_iter().chain(own.shown).map(|(node, _)| node);
        pass(scene, nodes.collect::<Vec<_>>())?;
        self.chrome.spread_scrim(self.scene, self.desk, whole)?;
        let root = self.scene.root();
        let on = GroupNode {
            transform: stage_transform(s, (w, h)),
            ..GroupNode::default()
        };
        let stage = self.scene.insert(root, on)?;
        let frame = spread.frame(now);
        let model = spread.model();
        let mut cards: Vec<&SpreadWindow> = model.windows().iter().collect();
        cards.sort_by_key(|w| model.order_of(&w.id));
        let mut options = Vec::new();
        for card in cards {
            let (Some(pose), Some(host)) = (frame.poses.get(&card.id), plan.window(&card.id))
            else {
                continue;
            };
            let at = rect(host.rect);
            let posed = GroupNode {
                transform: pose_transform(
                    at,
                    (pose.tx as f32, pose.ty as f32, pose.z as f32),
                    (pose.rotate_y as f32, pose.rotate_x as f32),
                    pose.scale as f32,
                ),
                opacity: pose.opacity as f32,
                clip: None,
            };
            let posed = self.scene.insert(stage, posed)?;
            let content = Node::from(GroupNode::default()).with_hit(false);
            let content = self.scene.insert(posed, content)?;
            window(
                self.scene,
                self.chrome,
                content,
                host,
                self.hosted,
                self.from,
                self.drawn,
            )?;
            let shown = model.shown().iter().any(|w| w.id == card.id);
            if !shown {
                continue;
            }
            let selected = model.selected() == Some(card.id.as_str());
            if selected {
                self.chrome.spread_ring(self.scene, content, at)?;
            }
            let hit = self
                .scene
                .insert(posed, RectNode::new(at, Color::TRANSPARENT))?;
            self.drawn.cards.push((hit, card.id.clone()));
            options.push((card, selected, hit));
        }
        let copy = (self.hosted.report().map(|r| r.copy.spread.clone())).unwrap_or_default();
        self.bar(spread, &copy, whole, options)
    }

    /// The field, the count and the hint above everything, and the spread for assistive
    /// technology.
    fn bar(
        &mut self,
        spread: &Spread,
        copy: &SpreadCopy,
        whole: Rect,
        options: Vec<(&SpreadWindow, bool, NodeId)>,
    ) -> Result<(), SceneError> {
        let model = spread.model();
        let s = self.from.scale;
        let flat = GroupNode {
            transform: desk_compositor::glam::Mat4::from_scale((s, s, 1.0).into()),
            ..GroupNode::default()
        };
        let root = self.scene.root();
        let top = self.scene.insert(root, flat)?;
        let (m, n) = (model.shown().len(), model.windows().len());
        let count = if m == n {
            fill(said(&copy.count, "{n} windows"), &[("n", n.to_string())])
        } else {
            let of = said(&copy.count_of, "{m} of {n} windows");
            fill(of, &[("m", m.to_string()), ("n", n.to_string())])
        };
        let typed = model.filter().trim().to_owned();
        let empty = (m == 0).then(|| {
            fill(
                said(&copy.no_match, "No window matches “{q}”"),
                &[("q", typed)],
            )
        });
        let hint = said(
            &copy.hint,
            "Arrows or Tab to choose · Enter to open · Esc to close",
        );
        let text = SpreadText {
            filter: model.filter(),
            placeholder: said(&copy.filter, "Type to filter by title"),
            count: &count,
            hint,
            empty: empty.as_deref(),
        };
        let made = self.chrome.spread_bar(self.scene, top, whole, &text)?;
        self.drawn.bar = made.nodes.clone();
        let field_rect = (self.scene.screen_bounds(made.field)).map_or(Rect::default(), |r| {
            Rect::new(r.x / s, r.y / s, r.width / s, r.height / s)
        });
        // In the spread's order, as the keys walk them, not the paint order.
        let mut options = options;
        let place = |id: &str| model.shown().iter().position(|w| w.id == id);
        options.sort_by_key(|(w, ..)| place(&w.id));
        let options = options
            .into_iter()
            .map(|(w, selected, hit)| {
                let r = self.scene.screen_bounds(hit).unwrap_or_default();
                let says = if w.asleep {
                    said(&copy.option_asleep, "{title} · asleep")
                } else {
                    said(&copy.option, "{title}")
                };
                ChromeOption {
                    id: w.id.clone(),
                    label: fill(says, &[("title", w.title.clone())]),
                    selected,
                    rect: Rect::new(r.x / s, r.y / s, r.width / s, r.height / s),
                }
            })
            .collect();
        self.drawn.spread = Some(ChromeSpread {
            label: said(&copy.label, "Spread windows").to_owned(),
            field: said(&copy.filter, "Type to filter by title").to_owned(),
            filter: model.filter().to_owned(),
            field_rect,
            count,
            hint: hint.to_owned(),
            options,
        });
        Ok(())
    }
}

#[cfg(test)]
#[path = "draw_spread_tests.rs"]
mod tests;
