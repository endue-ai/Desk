//! Shaping and line layout through cosmic-text (harfrust shaping, bidi, line breaking, font
//! fallback), cached by everything that changes the glyphs: text, font, size, weight, line height,
//! alignment, wrapping and the box. Colour and position are not in the key; they are applied when
//! the glyphs are placed.

use crate::text::fonts::Fonts;
use crate::text::style::{TextAlign, TextNode};
use cosmic_text::{
    Align, Attrs, Buffer, CacheKeyFlags, Ellipsize, EllipsizeHeightLimit, Family, LayoutGlyph,
    Metrics, Shaping, Weight, Wrap,
};
use std::collections::HashMap;
use std::sync::Arc;

/// One shaped glyph and the baseline it sits on, below the box's top edge.
#[derive(Clone, Debug)]
pub(crate) struct Shaped {
    pub glyph: LayoutGlyph,
    pub baseline: f32,
}

/// A node's text, shaped and broken into lines, positioned in its box.
#[derive(Debug, Default)]
pub(crate) struct Layout {
    pub glyphs: Vec<Shaped>,
    /// Glyphs no font had, drawn as a font's missing-glyph box.
    pub missing: usize,
    /// The widest line.
    pub width: f32,
    /// How many lines were set.
    pub lines: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct Key {
    text: Arc<str>,
    font: Arc<str>,
    size: u32,
    weight: u16,
    line_height: u32,
    align: TextAlign,
    wrap: bool,
    width: u32,
    height: u32,
}

impl Key {
    fn of(node: &TextNode) -> Key {
        let s = &node.style;
        Key {
            text: Arc::clone(&node.text),
            font: Arc::clone(&s.font.0),
            size: s.size.to_bits(),
            weight: s.weight,
            line_height: s.line_height.to_bits(),
            align: s.align,
            wrap: node.wrap,
            width: node.rect.width.to_bits(),
            height: node.rect.height.to_bits(),
        }
    }
}

/// Frames a layout stays cached after it was last drawn.
const KEEP_FRAMES: u64 = 240;

/// Layouts by what shapes them; entries not drawn for a while go.
#[derive(Default)]
pub(crate) struct Layouts {
    cache: HashMap<Key, (Arc<Layout>, u64)>,
    frame: u64,
}

impl Layouts {
    pub fn get(&mut self, fonts: &mut Fonts, node: &TextNode) -> Arc<Layout> {
        let key = Key::of(node);
        let frame = self.frame;
        if let Some((layout, used)) = self.cache.get_mut(&key) {
            *used = frame;
            return Arc::clone(layout);
        }
        let layout = Arc::new(lay_out(fonts, node));
        self.cache.insert(key, (Arc::clone(&layout), frame));
        layout
    }

    /// Forget layouts not drawn lately.
    pub fn end_frame(&mut self) {
        let frame = self.frame;
        self.cache
            .retain(|_, (_, used)| frame - *used <= KEEP_FRAMES);
        self.frame += 1;
    }

    pub fn clear(&mut self) {
        self.cache.clear();
    }
}

/// Shape `node`'s text in its box: one line centred down the box and cut with an ellipsis, or
/// wrapped lines from the top.
pub(crate) fn lay_out(fonts: &mut Fonts, node: &TextNode) -> Layout {
    let style = &node.style;
    let size = style.size.max(1.0);
    let line_height = size * style.line_height.max(0.5);
    let family = fonts.resolve(&style.font);
    let weight = fonts.weight(&family, style.weight.clamp(1, 1000));
    let attrs = Attrs::new()
        .family(Family::Name(&family))
        .weight(Weight(weight))
        // Glyphs keep their subpixel positions; hinting would pull them to the pixel grid.
        .cache_key_flags(CacheKeyFlags::DISABLE_HINTING);
    let align = match style.align {
        TextAlign::Start => None,
        TextAlign::Center => Some(Align::Center),
        TextAlign::End => Some(Align::End),
    };
    let mut buffer = Buffer::new(&mut fonts.system, Metrics::new(size, line_height));
    let mut buffer = buffer.borrow_with(&mut fonts.system);
    let width = node.rect.width.max(0.0);
    if node.wrap {
        buffer.set_wrap(Wrap::WordOrGlyph);
        buffer.set_size(Some(width), Some(node.rect.height.max(line_height)));
    } else {
        buffer.set_wrap(Wrap::None);
        buffer.set_ellipsize(Ellipsize::End(EllipsizeHeightLimit::Lines(1)));
        buffer.set_size(Some(width), None);
    }
    buffer.set_text(&node.text, &attrs, Shaping::Advanced, align);
    buffer.shape_until_scroll(true);
    let top = if node.wrap {
        0.0
    } else {
        ((node.rect.height - line_height) / 2.0).max(0.0)
    };
    let mut layout = Layout::default();
    for run in buffer.layout_runs() {
        if node.wrap && run.line_top > node.rect.height {
            break;
        }
        layout.width = layout.width.max(run.line_w);
        layout.lines += 1;
        // A glyph without a finite place (a shaping bug) is dropped rather than drawn anywhere.
        for glyph in run
            .glyphs
            .iter()
            .filter(|g| g.x.is_finite() && g.w.is_finite())
        {
            layout.missing += usize::from(glyph.glyph_id == 0);
            layout.glyphs.push(Shaped {
                glyph: glyph.clone(),
                baseline: top + run.line_y,
            });
        }
        if !node.wrap {
            break;
        }
    }
    layout
}
