//! Where a window's panes sit inside it (`packages/runtime/src/surface/surface.css` and
//! `panes.css`, `PaneView.ts`): a 1 px border round the window, a 40 px title bar, and under it
//! the body, split by the pane tree: the first pane of a split takes its `ratio` of the split's
//! width (a row) or height (a column), a 1 px divider follows, and the second takes the rest. The
//! same boxes the shell page lays its panes out in, so a pane the page draws (a shell view) and a
//! surface the compositor draws (a plugin) land on the same pixels.

use crate::types::{PaneNode, Rect, SplitDir};

/// The window's border, every side.
pub const BORDER: f64 = 1.0;
/// The title bar's height, its bottom line included.
pub const TITLE: f64 = 40.0;
/// A divider between two panes.
pub const DIVIDER: f64 = 1.0;
/// A pane's slim header (its title and close button, its bottom line included), drawn only when
/// the window has more than one pane.
pub const PANE_HEAD: f64 = 28.0;

/// A pane's box cut into its header and what it shows, when its window has more than one pane.
pub fn head_of(cell: Rect, many: bool) -> (Option<Rect>, Rect) {
    if !many {
        return (None, cell);
    }
    let head = PANE_HEAD.min(cell.h);
    (
        Some(Rect::new(cell.x, cell.y, cell.w, head)),
        Rect::new(cell.x, cell.y + head, cell.w, cell.h - head),
    )
}

/// The title bar's room before the title, where its icon sits (padding, a 16 px icon, a gap), and
/// after it, where its six 24 px tools sit (a gap, the tools 2 px apart, the end padding).
pub const TITLE_START: f64 = 12.0 + 16.0 + 8.0;
pub const TITLE_END: f64 = 8.0 + 6.0 * 24.0 + 5.0 * 2.0 + 8.0;

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

/// One pane's box, or a divider's.
#[derive(Clone, Debug, PartialEq)]
pub enum Cell {
    Pane {
        id: String,
        view: String,
        rect: Rect,
    },
    Divider {
        split: String,
        dir: SplitDir,
        rect: Rect,
    },
}

/// The boxes of `tree` laid out in `body`, first pane first, each divider after the panes before it.
pub fn cells(tree: &PaneNode, body: Rect) -> Vec<Cell> {
    let mut out = Vec::new();
    lay(tree, body, &mut out);
    out
}

fn lay(node: &PaneNode, at: Rect, out: &mut Vec<Cell>) {
    match node {
        PaneNode::View { id, view } => out.push(Cell::Pane {
            id: id.clone(),
            view: view.clone(),
            rect: at,
        }),
        PaneNode::Split {
            id,
            dir,
            ratio,
            a,
            b,
        } => {
            let (first, line, second) = split(at, *dir, *ratio);
            lay(a, first, out);
            out.push(Cell::Divider {
                split: id.clone(),
                dir: *dir,
                rect: line,
            });
            lay(b, second, out);
        }
    }
}

/// `at` cut at `ratio` along `dir`: the first part, the divider and the second part. The first
/// part never takes more than there is; the second gets what the first and the divider leave.
fn split(at: Rect, dir: SplitDir, ratio: f64) -> (Rect, Rect, Rect) {
    let ratio = if ratio.is_finite() {
        ratio.clamp(0.0, 1.0)
    } else {
        0.5
    };
    match dir {
        SplitDir::Row => {
            let a = (at.w * ratio).min(at.w);
            let line = DIVIDER.min(at.w - a);
            let b = (at.w - a - line).max(0.0);
            (
                Rect::new(at.x, at.y, a, at.h),
                Rect::new(at.x + a, at.y, line, at.h),
                Rect::new(at.x + a + line, at.y, b, at.h),
            )
        }
        SplitDir::Column => {
            let a = (at.h * ratio).min(at.h);
            let line = DIVIDER.min(at.h - a);
            let b = (at.h - a - line).max(0.0);
            (
                Rect::new(at.x, at.y, at.w, a),
                Rect::new(at.x, at.y + a, at.w, line),
                Rect::new(at.x, at.y + a + line, at.w, b),
            )
        }
    }
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
    fn a_row_gives_the_first_pane_its_share_then_a_divider_then_the_rest() {
        let tree = PaneNode::Split {
            id: "s1".into(),
            dir: SplitDir::Row,
            ratio: 0.25,
            a: Box::new(PaneNode::view("p1", "launcher")),
            b: Box::new(PaneNode::view("p2", "calendar")),
        };
        let got = cells(&tree, Rect::new(0.0, 0.0, 401.0, 100.0));
        assert_eq!(
            got,
            vec![
                Cell::Pane {
                    id: "p1".into(),
                    view: "launcher".into(),
                    rect: Rect::new(0.0, 0.0, 100.25, 100.0)
                },
                Cell::Divider {
                    split: "s1".into(),
                    dir: SplitDir::Row,
                    rect: Rect::new(100.25, 0.0, 1.0, 100.0)
                },
                Cell::Pane {
                    id: "p2".into(),
                    view: "calendar".into(),
                    rect: Rect::new(101.25, 0.0, 299.75, 100.0)
                },
            ]
        );
    }
}
