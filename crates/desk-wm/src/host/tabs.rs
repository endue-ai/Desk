//! Where a window's parts sit inside it (`packages/runtime/src/surface/surface.css` and
//! `tabs.css`, `TabsView.ts`): a 1 px border round the window, a 40 px title bar, and under it the
//! body, which the tab it shows fills. A window of more than one tab keeps a 28 px strip of its
//! tabs at the body's top (ADR 0268). The same boxes the shell page lays the window out in, so what
//! the page draws (a shell view, the strip) and a surface the compositor draws (a plugin) land on
//! the same pixels.

use crate::types::Rect;

/// The window's border, every side.
pub const BORDER: f64 = 1.0;
/// The title bar's height, its bottom line included.
pub const TITLE: f64 = 40.0;
/// The strip of a window's tabs (each one's title and close button, the strip's bottom line
/// included), drawn only when the window has more than one tab.
pub const TAB_STRIP: f64 = 28.0;

/// A window's body cut into the strip of its tabs and what the tab it shows fills, when it has
/// more than one tab.
pub fn strip_of(body: Rect, many: bool) -> (Option<Rect>, Rect) {
    if !many {
        return (None, body);
    }
    let strip = TAB_STRIP.min(body.h);
    (
        Some(Rect::new(body.x, body.y, body.w, strip)),
        Rect::new(body.x, body.y + strip, body.w, body.h - strip),
    )
}

/// The title bar's room before the title, where its icon sits (padding, a 16 px icon, a gap), and
/// after it, where its five 24 px tools sit (a gap, the tools 2 px apart, the end padding).
pub const TITLE_START: f64 = 12.0 + 16.0 + 8.0;
pub const TITLE_END: f64 = 8.0 + 5.0 * 24.0 + 4.0 * 2.0 + 8.0;

/// The title bar of a window drawn at `rect`: inside its border, its top 40 px.
pub fn title_bar_of(rect: Rect) -> Rect {
    Rect::new(
        rect.x + BORDER,
        rect.y + BORDER,
        (rect.w - 2.0 * BORDER).max(0.0),
        TITLE.min((rect.h - 2.0 * BORDER).max(0.0)),
    )
}

/// The body of a window drawn at `rect`: inside its border, under its title bar.
pub fn body_of(rect: Rect) -> Rect {
    Rect::new(
        rect.x + BORDER,
        rect.y + BORDER + TITLE,
        (rect.w - 2.0 * BORDER).max(0.0),
        (rect.h - 2.0 * BORDER - TITLE).max(0.0),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_body_is_inside_the_border_and_under_the_title_bar() {
        assert_eq!(
            body_of(Rect::new(100.0, 50.0, 400.0, 300.0)),
            Rect::new(101.0, 91.0, 398.0, 258.0)
        );
        assert_eq!(body_of(Rect::new(0.0, 0.0, 1.0, 10.0)).w, 0.0);
    }

    #[test]
    fn only_a_window_of_several_tabs_gives_its_bodys_top_to_their_strip() {
        let body = Rect::new(101.0, 91.0, 398.0, 258.0);
        assert_eq!(strip_of(body, false), (None, body));
        assert_eq!(
            strip_of(body, true),
            (
                Some(Rect::new(101.0, 91.0, 398.0, 28.0)),
                Rect::new(101.0, 119.0, 398.0, 230.0)
            )
        );
        // A body shorter than the strip is all strip.
        let short = Rect::new(0.0, 0.0, 100.0, 10.0);
        assert_eq!(strip_of(short, true).1.h, 0.0);
    }
}
