//! The spread's places (ADR 0116; the spread half of `packages/runtime/src/arrange/geometry.ts`):
//! a curved, layered fan, or a flat grid when motion is reduced. The same count on the same stage
//! always gives the same places.

use serde::{Deserialize, Serialize};

use crate::arrange::{grid_shape, row_sizes};
use crate::geometry::{DOCK_BAND, MIN};
use crate::math::{round, round_to};
use crate::types::{Insets, Rect};

/// One place in the spread: a box the window is fitted into, and how it sits in depth.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Slot {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// Towards the viewer in pixels (negative: further back).
    pub z: f64,
    /// Degrees about the vertical axis: the fan turns each card towards the middle.
    pub rotate_y: f64,
    /// Degrees about the horizontal axis: rows further back lean back.
    pub rotate_x: f64,
    /// Row from the top (0: the back row).
    pub row: usize,
    /// Position in its row from the left.
    pub col: usize,
    /// Paint order: front rows above back rows, the middle of a row above its ends.
    pub order: i64,
}

impl Slot {
    /// Its box.
    pub fn rect(&self) -> Rect {
        Rect::new(self.x, self.y, self.w, self.h)
    }
}

/// Room the spread keeps around its cards: the filter at the top, the dock's band at the bottom
/// (#158), a margin at the sides.
pub const SPREAD_INSET: Insets = Insets {
    top: 128.0,
    right: 72.0,
    bottom: DOCK_BAND,
    left: 72.0,
};
/// How far back each row behind the front one sits.
pub const DEPTH: f64 = 160.0;
/// How far, in degrees, the fan turns its outer cards.
pub const TURN: f64 = 14.0;
const GAP_X: f64 = 32.0;
const GAP_Y: f64 = 40.0;
/// The flat grid's gap.
pub(crate) const FLAT_GAP: f64 = 24.0;
/// At most this many cards in a row of the fan.
const MOST: usize = 7;
/// The window shape the fan sizes its boxes for.
const CARD_ASPECT: f64 = 1.4;
/// How far a row's outer cards dip, in rows: the front row's dip stays on the stage too.
const DIP: f64 = 0.08;

/// The stage the spread lays its cards on, for an app `vw`×`vh`.
pub fn spread_stage(vw: f64, vh: f64) -> Rect {
    let i = SPREAD_INSET;
    Rect::new(
        i.left,
        i.top,
        MIN.w.max(vw - i.left - i.right),
        MIN.h.max(vh - i.top - i.bottom),
    )
}

/// `n` cards in `rows` balanced rows, back row first, the back rows taking the extra.
fn balanced(n: usize, rows: usize) -> Vec<usize> {
    let base = n / rows;
    (0..rows)
        .map(|r| base + usize::from(r < n % rows))
        .collect()
}

/// The height of each of `rows` rows of the fan on `stage`, the front row's dip under them.
fn row_height(stage: Rect, rows: usize) -> f64 {
    (stage.h - GAP_Y * (rows as f64 - 1.0)) / (rows.max(1) as f64 + DIP)
}

/// The width of a card box in a row of `k` that is `row_h` tall.
fn box_width(stage: Rect, k: usize, row_h: f64) -> f64 {
    let k = k as f64;
    ((stage.w - GAP_X * (k - 1.0)) / k).min(row_h * 1.6)
}

/// Rows of the fan for `n` cards, back row first: the count whose smallest card comes out largest,
/// each further row costing a quarter, so a few windows make one wide fan and many make layers.
pub fn fan_rows(n: usize, stage: Rect) -> Vec<usize> {
    if n == 0 {
        return Vec::new();
    }
    let mut best = (vec![n], -1.0);
    for rows in n.div_ceil(MOST)..=n {
        let sizes = balanced(n, rows);
        let row_h = row_height(stage, rows);
        let smallest = sizes
            .iter()
            .map(|&k| {
                let w = box_width(stage, k, row_h).min(row_h * CARD_ASPECT);
                (w * w) / CARD_ASPECT
            })
            .fold(f64::INFINITY, f64::min);
        let score = smallest * 0.75f64.powi(rows as i32 - 1);
        if score > best.1 + 1e-9 {
            best = (sizes, score);
        }
    }
    best.0
}

/// The spread's places for `n` windows on `stage`, back row first and each row left to right. The
/// fan curves: the outer cards of a row dip a little, turn towards the middle and come a little
/// forward; rows further back sit higher, deeper and lean back. `flat` (reduced motion) lays the
/// same boxes out as a plain grid: no turn, no depth.
pub fn spread_slots(n: usize, stage: Rect, flat: bool) -> Vec<Slot> {
    if flat {
        return flat_slots(n, stage);
    }
    let rows = fan_rows(n, stage);
    let count = rows.len();
    let row_h = row_height(stage, count);
    let mut slots = Vec::with_capacity(n);
    for (row, &k) in rows.iter().enumerate() {
        let w = box_width(stage, k, row_h);
        let kf = k as f64;
        let left = stage.x + (stage.w - (kf * w + (kf - 1.0) * GAP_X)) / 2.0;
        let back = (count - 1 - row) as f64;
        for col in 0..k {
            let half = (kf - 1.0) / 2.0;
            let t = if k > 1 {
                (col as f64 - half) / half
            } else {
                0.0
            };
            slots.push(Slot {
                x: round_to(left + col as f64 * (w + GAP_X), 2),
                y: round_to(
                    stage.y + row as f64 * (row_h + GAP_Y) + t * t * row_h * DIP,
                    2,
                ),
                w: round_to(w, 2),
                h: round_to(row_h, 2),
                z: round_to(-back * DEPTH + t * t * 32.0, 2),
                rotate_y: round_to(-t * TURN, 2),
                rotate_x: back * 3.0,
                row,
                col,
                order: (row as i64 + 1) * 100 - round(t.abs() * 10.0) as i64,
            });
        }
    }
    slots
}

/// The reduced-motion spread: the stage as a grid of equal boxes, a short last row centred.
pub fn flat_slots(n: usize, stage: Rect) -> Vec<Slot> {
    let gap = FLAT_GAP;
    let cols = grid_shape(n, stage, gap).cols;
    let sizes = row_sizes(n, cols);
    let w = (stage.w - gap * (cols as f64 - 1.0)) / cols as f64;
    let h = (stage.h - gap * (sizes.len() as f64 - 1.0)) / sizes.len().max(1) as f64;
    let mut slots = Vec::with_capacity(n);
    for (row, &k) in sizes.iter().enumerate() {
        let kf = k as f64;
        let left = stage.x + (stage.w - (kf * w + (kf - 1.0) * gap)) / 2.0;
        for col in 0..k {
            slots.push(Slot {
                x: round_to(left + col as f64 * (w + gap), 2),
                y: round_to(stage.y + row as f64 * (h + gap), 2),
                w: round_to(w, 2),
                h: round_to(h, 2),
                z: 0.0,
                rotate_y: 0.0,
                rotate_x: 0.0,
                row,
                col,
                order: 1,
            });
        }
    }
    slots
}
