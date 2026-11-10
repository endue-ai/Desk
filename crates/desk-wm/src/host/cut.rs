//! A rect with holes cut out of it, as rects: where the page's system layer is drawn above the
//! windows, the screen without what the page draws of a window under another (`Plan::page`).

use crate::types::Rect;

/// The part `a` and `b` share, if any.
pub fn intersect(a: Rect, b: Rect) -> Option<Rect> {
    let x = a.x.max(b.x);
    let y = a.y.max(b.y);
    let w = a.right().min(b.right()) - x;
    let h = a.bottom().min(b.bottom()) - y;
    (w > 0.0 && h > 0.0).then_some(Rect::new(x, y, w, h))
}

/// `from` without every rect of `holes`: at most four pieces per hole and piece, none empty.
pub fn subtract(from: Rect, holes: &[Rect]) -> Vec<Rect> {
    let mut pieces = vec![from];
    for hole in holes.iter().filter(|h| h.w > 0.0 && h.h > 0.0) {
        let mut next = Vec::with_capacity(pieces.len() + 4);
        for piece in pieces {
            if !piece.overlaps(hole) {
                next.push(piece);
                continue;
            }
            let top = hole.y.max(piece.y);
            let bottom = hole.bottom().min(piece.bottom());
            let parts = [
                // Above the hole, the piece's whole width.
                Rect::new(piece.x, piece.y, piece.w, top - piece.y),
                // Below it.
                Rect::new(piece.x, bottom, piece.w, piece.bottom() - bottom),
                // Beside it, between the two.
                Rect::new(piece.x, top, hole.x - piece.x, bottom - top),
                Rect::new(
                    hole.right(),
                    top,
                    piece.right() - hole.right(),
                    bottom - top,
                ),
            ];
            next.extend(parts.into_iter().filter(|r| r.w > 0.0 && r.h > 0.0));
        }
        pieces = next;
    }
    pieces
}

#[cfg(test)]
mod tests {
    use super::*;

    fn area(rects: &[Rect]) -> f64 {
        rects.iter().map(|r| r.w * r.h).sum()
    }

    #[test]
    fn a_hole_in_the_middle_leaves_four_pieces_round_it() {
        let pieces = subtract(
            Rect::new(0.0, 0.0, 100.0, 100.0),
            &[Rect::new(25.0, 25.0, 50.0, 50.0)],
        );
        assert_eq!(pieces.len(), 4);
        assert_eq!(area(&pieces), 100.0 * 100.0 - 50.0 * 50.0);
        assert!(
            pieces
                .iter()
                .all(|p| !p.overlaps(&Rect::new(25.0, 25.0, 50.0, 50.0)))
        );
    }

    #[test]
    fn overlapping_holes_and_holes_off_the_rect_are_cut_once() {
        let from = Rect::new(0.0, 0.0, 100.0, 100.0);
        let holes = [
            Rect::new(-10.0, -10.0, 60.0, 60.0),
            Rect::new(40.0, 40.0, 20.0, 20.0),
            Rect::new(200.0, 0.0, 10.0, 10.0),
        ];
        let pieces = subtract(from, &holes);
        assert_eq!(area(&pieces), 10_000.0 - 2500.0 - (400.0 - 100.0));
        assert_eq!(subtract(from, &[from]), Vec::<Rect>::new());
    }
}
