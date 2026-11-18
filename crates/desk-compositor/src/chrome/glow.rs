//! A window Eris is at (ADR 0271): lit in the star's colour, the brand's mark of an agent at work,
//! around its frame, a rim just outside it and a soft halo past that, as bright as the page says
//! (softly while she looks at the window, fully while she uses it). The glow lies under the frame
//! in the window's group: it moves with the window, shows only outside it and goes under whatever
//! lies over the window.

use super::{Chrome, Role, WindowChrome};
use crate::node::{Node, NodeId, RectNode};
use crate::scene::{Scene, SceneError};
use crate::types::{Color, Rect, Shadow, Stroke};
use glam::Vec2;

/// How far outside the frame the rim reaches, which is its width.
const RIM: f32 = 2.0;
/// The halo's blur radius.
const HALO: f32 = 28.0;
/// The rim's and the halo's alpha at full brightness.
const RIM_ALPHA: f32 = 0.75;
const HALO_ALPHA: f32 = 0.42;

impl Chrome {
    /// Light `window` `level` bright, 0 (nothing is drawn) to 1: under its frame, letting the
    /// pointer through.
    pub fn glow(
        &mut self,
        scene: &mut Scene,
        window: &WindowChrome,
        level: f32,
    ) -> Result<Option<NodeId>, SceneError> {
        let level = (level.clamp(0.0, 1.0) * 100.0).round() as u8;
        if level == 0 {
            return Ok(None);
        }
        let base = self.part_mut(window.frame)?.base;
        let node = self.add(scene, window.group, Role::WindowGlow(level), base, "")?;
        let lit = scene
            .node(node)
            .cloned()
            .ok_or(SceneError::NoSuchNode(node))?;
        scene.set(node, lit.with_hit(false))?;
        scene.reorder(node, 0)?;
        Ok(Some(node))
    }

    /// The glow around a window whose frame is `base`, `level` hundredths bright.
    pub(super) fn glow_node(&self, base: Rect, level: u8) -> Node {
        let w = &self.theme.window;
        let bright = f32::from(level) / 100.0;
        RectNode {
            stroke: Some(Stroke {
                width: RIM,
                color: w.glow.fade(RIM_ALPHA * bright),
            }),
            radius: w.radius + RIM,
            shadow: Some(Shadow {
                offset: Vec2::ZERO,
                blur: HALO,
                spread: 0.0,
                color: w.glow.fade(HALO_ALPHA * bright),
            }),
            ..RectNode::new(base.inflate(RIM), Color::TRANSPARENT)
        }
        .into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::NodeKind;
    use crate::theme::{ChromeTheme, Tokens};

    fn lit(scene: &Scene, node: NodeId) -> RectNode {
        match &scene.node(node).unwrap().kind {
            NodeKind::Rect(rect) => *rect,
            other => panic!("the glow is a rectangle, not {other:?}"),
        }
    }

    #[test]
    fn a_window_eris_is_at_glows_in_the_stars_colour_just_outside_its_frame_and_under_it() {
        let mut scene = Scene::new(800, 600);
        let mut chrome = Chrome::new(ChromeTheme::default());
        let root = scene.root();
        let at = Rect::new(100.0, 80.0, 400.0, 300.0);
        let w = chrome
            .window(&mut scene, root, at, "Mail", None, false)
            .unwrap();
        let glow = chrome.glow(&mut scene, &w, 1.0).unwrap().expect("lit");
        let brand = chrome.theme().window.glow;
        let node = lit(&scene, glow);
        // The rim is the 2 px around the frame, in the window's own units.
        assert_eq!(node.rect, Rect::new(-2.0, -2.0, 404.0, 304.0));
        assert_eq!(node.radius, chrome.theme().window.radius + 2.0);
        assert_eq!(node.fill, Color::TRANSPARENT, "nothing over the window");
        let rim = node.stroke.unwrap();
        assert_eq!((rim.width, rim.color), (2.0, brand.fade(0.75)));
        let halo = node.shadow.unwrap();
        assert_eq!((halo.offset, halo.spread), (Vec2::ZERO, 0.0));
        assert_eq!(halo.color, brand.fade(0.42));
        // Under the frame, so only what lies outside the window shows; the pointer goes through.
        assert_eq!(scene.children(w.group)[..2], [glow, w.frame]);
        assert!(!scene.node(glow).unwrap().hit);
    }

    #[test]
    fn a_window_she_only_looks_at_glows_softer_and_a_dark_one_has_no_glow_at_all() {
        let mut scene = Scene::new(800, 600);
        let mut chrome = Chrome::new(ChromeTheme::default());
        let root = scene.root();
        let at = Rect::new(0.0, 0.0, 400.0, 300.0);
        let w = chrome
            .window(&mut scene, root, at, "Mail", None, true)
            .unwrap();
        let before = scene.children(w.group).len();
        assert_eq!(chrome.glow(&mut scene, &w, 0.0).unwrap(), None);
        assert_eq!(chrome.glow(&mut scene, &w, -1.0).unwrap(), None);
        assert_eq!(scene.children(w.group).len(), before, "nothing drawn");
        let soft = chrome.glow(&mut scene, &w, 0.6).unwrap().expect("lit");
        let brand = chrome.theme().window.glow;
        let rim = lit(&scene, soft).stroke.unwrap().color;
        assert!((rim.a - brand.a * 0.45).abs() < 1e-6, "{rim:?}");
        let halo = lit(&scene, soft).shadow.unwrap().color;
        assert!((halo.a - brand.a * 0.252).abs() < 1e-6, "{halo:?}");
        // Past full it is full.
        let full = chrome.glow(&mut scene, &w, 7.0).unwrap().expect("lit");
        assert_eq!(lit(&scene, full).stroke.unwrap().color, brand.fade(0.75));
    }

    #[test]
    fn the_glow_takes_the_themes_star_and_follows_a_new_look() {
        let mut scene = Scene::new(800, 600);
        let mut chrome = Chrome::new(ChromeTheme::default());
        let root = scene.root();
        let at = Rect::new(0.0, 0.0, 400.0, 300.0);
        let w = chrome
            .window(&mut scene, root, at, "Mail", None, false)
            .unwrap();
        let glow = chrome.glow(&mut scene, &w, 1.0).unwrap().expect("lit");
        assert_eq!(
            lit(&scene, glow).stroke.unwrap().color,
            Color::hex(0xb6a3f5).fade(0.75),
            "the endue look's star"
        );
        let amber: Tokens = [("star", "#f2b84b")].into_iter().collect();
        chrome.set_theme(&mut scene, ChromeTheme::from_tokens(&amber));
        let node = scene.node(glow).unwrap();
        assert!(!node.hit, "still lets the pointer through");
        assert_eq!(
            lit(&scene, glow).stroke.unwrap().color,
            Color::hex(0xf2b84b).fade(0.75)
        );
    }
}
