//! The pane tree inside a window (`packages/runtime/src/surface/tree.ts`): split a pane right or
//! down, close one, show another view in one, resize a split. Pure functions over `PaneNode`
//! (`types.rs`), so a layout stays JSON. Also the dividers' rules of `surface/PaneView.ts`: a drag
//! moves one by the pointer's share of the split, an arrow key by a step.

use crate::math::round_to;
use crate::types::{PaneNode, SplitDir};

/// No pane of a split takes less than this share.
pub const MIN_RATIO: f64 = 0.15;
/// What a new pane shows: the launcher, to pick a view.
pub const LAUNCHER: &str = "launcher";
/// How far an arrow key moves a divider.
pub const STEP: f64 = 0.05;

/// The pane `id` among `node`'s panes that show something: `(id, view)`.
pub fn find_leaf<'a>(node: &'a PaneNode, id: &str) -> Option<(&'a str, &'a str)> {
    node.leaves().into_iter().find(|(leaf, _)| *leaf == id)
}

fn all_ids<'a>(node: &'a PaneNode, out: &mut Vec<&'a str>) {
    match node {
        PaneNode::View { id, .. } => out.push(id),
        PaneNode::Split { id, a, b, .. } => {
            out.push(id);
            all_ids(a, out);
            all_ids(b, out);
        }
    }
}

/// The next free pane id: `p1`, `p2`, ..., one past every number a pane (`p`) or a split (`s`)
/// already has, so an id is never reused.
pub fn next_pane_id(node: &PaneNode) -> String {
    let mut ids = Vec::new();
    all_ids(node, &mut ids);
    let highest = ids
        .iter()
        .filter_map(|id| {
            let digits = id.strip_prefix('p').or_else(|| id.strip_prefix('s'))?;
            let all_digits = !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit());
            all_digits.then(|| digits.parse::<u64>().unwrap_or(u64::MAX - 1))
        })
        .max()
        .unwrap_or(0);
    format!("p{}", highest + 1)
}

/// `node` with the first node `change` answers for replaced, depth first from the top.
fn map(node: &PaneNode, change: &impl Fn(&PaneNode) -> Option<PaneNode>) -> PaneNode {
    if let Some(changed) = change(node) {
        return changed;
    }
    match node {
        PaneNode::View { .. } => node.clone(),
        PaneNode::Split {
            id,
            dir,
            ratio,
            a,
            b,
        } => PaneNode::Split {
            id: id.clone(),
            dir: *dir,
            ratio: *ratio,
            a: Box::new(map(a, change)),
            b: Box::new(map(b, change)),
        },
    }
}

/// Split pane `id` in two: it keeps the first half, a new pane showing `view` takes the second.
/// Answers the tree and the new pane's id.
pub fn split(node: &PaneNode, id: &str, dir: SplitDir, view: &str) -> (PaneNode, String) {
    let added = next_pane_id(node);
    let split_id = format!("s{}", &added[1..]);
    let next = map(node, &|n| match n {
        PaneNode::View { id: leaf, .. } if leaf == id => Some(PaneNode::Split {
            id: split_id.clone(),
            dir,
            ratio: 0.5,
            a: Box::new(n.clone()),
            b: Box::new(PaneNode::view(added.clone(), view)),
        }),
        _ => None,
    });
    (next, added)
}

fn is_view(node: &PaneNode, id: &str) -> bool {
    matches!(node, PaneNode::View { id: leaf, .. } if leaf == id)
}

/// Close pane `id`; its sibling takes the whole split. `None` when it was the last pane.
pub fn close(node: &PaneNode, id: &str) -> Option<PaneNode> {
    match node {
        PaneNode::View { .. } => (!is_view(node, id)).then(|| node.clone()),
        PaneNode::Split { a, b, .. } if is_view(a, id) => Some((**b).clone()),
        PaneNode::Split { a, b, .. } if is_view(b, id) => Some((**a).clone()),
        PaneNode::Split {
            id: split_id,
            dir,
            ratio,
            a,
            b,
        } => Some(PaneNode::Split {
            id: split_id.clone(),
            dir: *dir,
            ratio: *ratio,
            a: Box::new(close(a, id).unwrap_or_else(|| (**a).clone())),
            b: Box::new(close(b, id).unwrap_or_else(|| (**b).clone())),
        }),
    }
}

/// Pane `id` showing `view`.
pub fn set_view(node: &PaneNode, id: &str, view: &str) -> PaneNode {
    map(node, &|n| match n {
        PaneNode::View { id: leaf, .. } if leaf == id => Some(PaneNode::view(leaf.clone(), view)),
        _ => None,
    })
}

/// A ratio as a split keeps it: between `MIN_RATIO` and `1 - MIN_RATIO`, to three decimals.
pub fn clamp_ratio(ratio: f64) -> f64 {
    round_to(ratio.clamp(MIN_RATIO, 1.0 - MIN_RATIO), 3)
}

/// Split `split_id` giving its first pane `ratio`, clamped (`clamp_ratio`).
pub fn set_ratio(node: &PaneNode, split_id: &str, ratio: f64) -> PaneNode {
    let clamped = clamp_ratio(ratio);
    map(node, &|n| match n {
        PaneNode::Split { id, dir, a, b, .. } if id == split_id => Some(PaneNode::Split {
            id: id.clone(),
            dir: *dir,
            ratio: clamped,
            a: a.clone(),
            b: b.clone(),
        }),
        _ => None,
    })
}

/// The ratio an arrow key gives a divider at `ratio`: along a row Left and Right, along a column
/// Up and Down, a `STEP` each; other keys pass (`None`). Setting it clamps it.
pub fn key_ratio(ratio: f64, dir: SplitDir, key: &str) -> Option<f64> {
    let (less, more) = match dir {
        SplitDir::Row => ("ArrowLeft", "ArrowRight"),
        SplitDir::Column => ("ArrowUp", "ArrowDown"),
    };
    if key == more {
        Some(ratio + STEP)
    } else if key == less {
        Some(ratio - STEP)
    } else {
        None
    }
}

/// The ratio a divider dragged by `dx`, `dy` from `start` shows, in a split `size` pixels along its
/// direction (at least one): the pointer's share of the split, within the bounds. The drop sets it.
pub fn drag_ratio(start: f64, dir: SplitDir, dx: f64, dy: f64, size: f64) -> f64 {
    let along = match dir {
        SplitDir::Row => dx,
        SplitDir::Column => dy,
    };
    (start + along / size.max(1.0)).clamp(MIN_RATIO, 1.0 - MIN_RATIO)
}
