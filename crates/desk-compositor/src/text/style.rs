//! Text nodes: a line (or a wrapped block) of chrome text in a box, as plain data. Chrome text is
//! never edited, so there is no caret, selection or IME here.

use crate::types::{Color, Rect};
use std::sync::Arc;

/// A CSS `font-family` list, as a theme's `fontSans` token holds one: `"Inter", -apple-system,
/// sans-serif`. The first family the compositor's [`crate::Fonts`] has is used; glyphs it lacks fall
/// back across the other fonts (Hangul, CJK, emoji).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct FontStack(pub Arc<str>);

impl FontStack {
    pub fn new(css: &str) -> FontStack {
        FontStack(Arc::from(css))
    }

    /// `sans-serif`: the desk's sans family.
    pub fn sans() -> FontStack {
        FontStack::new("sans-serif")
    }

    /// The families in order, quotes taken off; generic names (`sans-serif`, `monospace`,
    /// `system-ui`, `-apple-system`) stay as written.
    pub fn families(&self) -> impl Iterator<Item = &str> + '_ {
        self.0
            .split(',')
            .map(|f| f.trim().trim_matches(|c| c == '"' || c == '\''))
            .filter(|f| !f.is_empty())
    }
}

impl Default for FontStack {
    fn default() -> FontStack {
        FontStack::sans()
    }
}

/// Where a line sits across its box.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum TextAlign {
    #[default]
    Start,
    Center,
    End,
}

/// How text is set: its font, size in the node's units, weight (100 to 900), colour, line height
/// as a multiple of the size, and alignment.
#[derive(Clone, Debug, PartialEq)]
pub struct TextStyle {
    pub font: FontStack,
    pub size: f32,
    pub weight: u16,
    pub color: Color,
    pub line_height: f32,
    pub align: TextAlign,
}

impl Default for TextStyle {
    fn default() -> TextStyle {
        TextStyle {
            font: FontStack::sans(),
            size: 14.0,
            weight: 400,
            color: Color::WHITE,
            line_height: 1.4,
            align: TextAlign::Start,
        }
    }
}

/// Text in a box. One line by default, centred down the box and cut with an ellipsis where it
/// would overflow (a title); with `wrap` it breaks into lines from the top (a toast's message).
/// Nothing is drawn outside `rect`.
#[derive(Clone, Debug, PartialEq)]
pub struct TextNode {
    pub rect: Rect,
    pub text: Arc<str>,
    pub style: TextStyle,
    pub wrap: bool,
}

impl TextNode {
    /// One line of `text` in `rect`, in `style`.
    pub fn new(rect: Rect, text: &str, style: TextStyle) -> TextNode {
        TextNode {
            rect,
            text: Arc::from(text),
            style,
            wrap: false,
        }
    }

    /// The same text, broken into lines at the box's width.
    pub fn wrapped(self) -> TextNode {
        TextNode { wrap: true, ..self }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stack_lists_its_families_unquoted() {
        let stack = FontStack::new(r#""Inter", 'SUIT Variable', -apple-system , sans-serif,"#);
        let families: Vec<&str> = stack.families().collect();
        assert_eq!(
            families,
            ["Inter", "SUIT Variable", "-apple-system", "sans-serif"]
        );
    }
}
