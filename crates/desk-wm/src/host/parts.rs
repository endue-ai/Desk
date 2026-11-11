//! What the page draws of a window (its title bar's icon and tools, its own views, split panes'
//! headers), taken from where the page lays the window out and drawn where the compositor draws it
//! (#80). The two are the same place but while the window manager moves a window ahead of the page
//! (a gesture holding it, a glide into a part, a change the runtime has not taken yet). A part
//! is never stretched: a piece of the same size is drawn from its top left, and the title bar's
//! tools keep to its right end, so they stay at the window's corner while it grows or shrinks.

use super::HostWindow;
use crate::types::Rect;

/// A piece the page draws: where it is in the page, and where it is drawn on screen.
pub type PagePart = (Rect, Rect);

/// The piece `src` and `dst` share in size, from their top lefts.
fn from_left(src: Rect, dst: Rect) -> PagePart {
    let (w, h) = (src.w.min(dst.w), src.h.min(dst.h));
    (Rect::new(src.x, src.y, w, h), Rect::new(dst.x, dst.y, w, h))
}

/// The piece `src` and `dst` share in size, from their top rights.
fn from_right(src: Rect, dst: Rect) -> PagePart {
    let (w, h) = (src.w.min(dst.w), src.h.min(dst.h));
    (
        Rect::new(src.right() - w, src.y, w, h),
        Rect::new(dst.right() - w, dst.y, w, h),
    )
}

/// The title bar: its start (the icon) from the left, its tools from the right.
fn title_bar(page: &HostWindow, drawn: &HostWindow) -> Vec<PagePart> {
    let (src, dst) = (page.title_bar, drawn.title_bar);
    if src.w == dst.w {
        return vec![(src, dst)];
    }
    let tools = |w: &HostWindow| (w.title_insets().1 - super::BORDER).max(0.0);
    let end = tools(page).min(tools(drawn));
    if end <= 0.0 || src.w < end || dst.w < end {
        return vec![from_left(src, dst)];
    }
    let start = (src.w.min(dst.w) - end).max(0.0);
    vec![
        from_left(
            Rect::new(src.x, src.y, start, src.h),
            Rect::new(dst.x, dst.y, start, dst.h),
        ),
        from_right(
            Rect::new(src.right() - end, src.y, end, src.h),
            Rect::new(dst.right() - end, dst.y, end, dst.h),
        ),
    ]
}

/// What the page draws of window `drawn`, from the page's laying it out as `page`: the same
/// panes in the same order.
pub fn page_parts(page: &HostWindow, drawn: &HostWindow) -> Vec<PagePart> {
    let mut all = title_bar(page, drawn);
    for (src, dst) in page.panes.iter().zip(&drawn.panes) {
        if let (Some(a), Some(b)) = (src.head, dst.head) {
            all.push(from_left(a, b));
        }
        if src.plugin.is_none() && dst.plugin.is_none() {
            all.push(from_left(src.rect, dst.rect));
        }
    }
    all.retain(|(src, _)| src.w > 0.0 && src.h > 0.0);
    all
}

/// Where the page draws a window it lays out where it is drawn: each part at its own place.
pub fn in_place(w: &HostWindow) -> Vec<PagePart> {
    w.drawn_by_page().into_iter().map(|r| (r, r)).collect()
}

/// `parts` without what the page shows of `holes` (in the page): each piece left is drawn where
/// its part is, shifted alike. What the system layer draws above every window (Eris, the rail)
/// is the page's in the same picture; a window's parts leave it out, so a card in the spread shows
/// the window and not what floated over it (#159 finding 15).
pub fn cut_out(parts: &[PagePart], holes: &[Rect]) -> Vec<PagePart> {
    if holes.is_empty() {
        return parts.to_vec();
    }
    let mut out = Vec::new();
    for (src, dst) in parts {
        let (dx, dy) = (dst.x - src.x, dst.y - src.y);
        for piece in super::subtract(*src, holes) {
            out.push((
                piece,
                Rect::new(piece.x + dx, piece.y + dy, piece.w, piece.h),
            ));
        }
    }
    out
}
