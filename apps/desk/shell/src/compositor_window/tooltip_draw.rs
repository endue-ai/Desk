//! Where a hover title is drawn and how (#156): a box in the theme's tooltip look (`tooltip`,
//! `tooltipText`, `tooltipRadius`, `tooltipShadow`, the shell's `.tooltip` padding and its 12 px
//! text on 20 px lines), sized to the title set in the compositor's fonts and broken past the
//! style's widest, under the pointer's arrow, or above the pointer where the window has no room
//! below, never past the window's edges. In device pixels, at the scene's root over everything,
//! and it takes no pointer.

use desk_compositor::glam::Vec2;
use desk_compositor::{
    Fonts, Node, Rect, RectNode, Scene, Shadow, TextNode, TextStyle, TooltipStyle,
};

use super::Tip;

/// Under the pointer by the arrow's height (CSS px), or above it by this gap.
const BELOW: f32 = 20.0;
const ABOVE: f32 = 6.0;
/// Kept clear of the window's edges (CSS px).
const MARGIN: f32 = 4.0;

/// A title laid out: its box and its text's box in it (device px), and its text.
#[derive(Clone, Debug, PartialEq)]
pub struct Placed {
    pub pill: Rect,
    pub inner: Rect,
    pub text: String,
}

/// The title's text style at `scale` device px a CSS px.
fn text_style(style: &TooltipStyle, scale: f32) -> TextStyle {
    TextStyle {
        size: style.text.size * scale,
        ..style.text.clone()
    }
}

/// Lay `tip` out in `style`: measured in `fonts`, near its pointer in a `viewport` (device px).
pub fn place(
    fonts: &mut Fonts,
    style: &TooltipStyle,
    tip: &Tip,
    scale: f32,
    viewport: (u32, u32),
) -> Placed {
    let room = viewport.0 as f32 - 2.0 * (MARGIN + style.padding_x) * scale;
    let widest = (style.max_width * scale).min(room).max(scale);
    let measured = TextNode::new(
        Rect::new(0.0, 0.0, widest, 1.0e6),
        &tip.text,
        text_style(style, scale),
    );
    let (width, lines) = fonts.measure(&measured.wrapped());
    // A pixel to spare, so the text breaks where it was measured.
    let width = (width.ceil() + 1.0).min(widest.max(1.0));
    let (pill, inner) = boxes(tip.at, (width, lines.max(1)), style, scale, viewport);
    Placed {
        pill,
        inner,
        text: tip.text.clone(),
    }
}

/// The box and the text's box for text `width` device px wide in `lines` lines, near `at`.
pub fn boxes(
    at: Vec2,
    (width, lines): (f32, usize),
    style: &TooltipStyle,
    scale: f32,
    (vw, vh): (u32, u32),
) -> (Rect, Rect) {
    let line = style.text.size * style.text.line_height * scale;
    let (px, py) = (style.padding_x * scale, style.padding_y * scale);
    let (w, h) = (width + 2.0 * px, line * lines as f32 + 2.0 * py);
    let (vw, vh, margin) = (vw as f32, vh as f32, MARGIN * scale);
    let x = at.x.min(vw - margin - w).max(margin);
    let below = at.y + BELOW * scale;
    let y = if below + h <= vh - margin {
        below
    } else {
        (at.y - ABOVE * scale - h).max(margin)
    };
    let inner = Rect::new(x + px, y + py, width, line * lines as f32);
    (Rect::new(x, y, w, h), inner)
}

/// Draw `placed` in `style` at the scene's root.
pub fn draw(scene: &mut Scene, placed: &Placed, style: &TooltipStyle, scale: f32) {
    let shadow = style.shadow.map(|s| Shadow {
        offset: s.offset * scale,
        blur: s.blur * scale,
        spread: s.spread * scale,
        color: s.color,
    });
    let pill = RectNode {
        rect: placed.pill,
        fill: style.fill,
        stroke: None,
        radius: style.radius * scale,
        shadow,
    };
    let text = TextNode::new(placed.inner, &placed.text, text_style(style, scale)).wrapped();
    let root = scene.root();
    let _ = scene.insert(root, Node::from(pill).with_hit(false));
    let _ = scene.insert(root, Node::from(text).with_hit(false));
}
