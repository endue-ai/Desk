//! The spread without a view (ADR 0116; `SpreadModel` in
//! `packages/runtime/src/arrange/spread-model.ts`): which window takes which place in the fan, the
//! filter, the selection and how the keys move it, the camera the person pans and zooms, and the
//! pose each window is drawn at.
//!
//! The controller around it (`arrange/spread.ts`: the motions on the frame loop, giving the focus
//! once the spread has closed, drawing) is the compositor's spread (#54).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::pose::{Camera, IDENTITY, Pose, ZOOM_MAX, ZOOM_MIN};
use super::slots::{FLAT_GAP, Slot, fan_rows, spread_slots, spread_stage};
use super::windows::{SpreadWindow, centre, fold, spread_order};
use crate::arrange::{grid_shape, row_sizes};
use crate::math::round_to;
use crate::types::{KeyPress, Rect};

/// How far the selected card has to stay from the app's edges when the keys move to it.
const MARGIN: f64 = 24.0;

/// How a key moves the selection.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Move {
    Left,
    Right,
    Up,
    Down,
    Next,
    Previous,
    First,
    Last,
}

/// What a key did in the spread.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SpreadAction {
    /// Close on this window: it comes into sight and takes the focus.
    Choose { id: String },
    /// Close with nothing chosen.
    Cancel,
    /// The selection moved (or stayed at an end).
    Moved,
    /// Not the spread's key.
    None,
}

/// The spread over a desktop's windows in an app `vw`×`vh`.
#[derive(Clone, Debug, PartialEq)]
pub struct SpreadModel {
    vw: f64,
    vh: f64,
    flat: bool,
    windows: Vec<SpreadWindow>,
    filter: String,
    selected: Option<String>,
    camera: Camera,
    /// Every window's place with no filter.
    all: BTreeMap<String, Slot>,
    /// The windows the filter lets through, in the spread's order, and their places.
    shown: Vec<SpreadWindow>,
    slots: BTreeMap<String, Slot>,
}

impl SpreadModel {
    /// The spread of `windows`, flat when motion is reduced, on `selected` when it shows (the
    /// focused window), else on the first card.
    pub fn new(
        windows: Vec<SpreadWindow>,
        vw: f64,
        vh: f64,
        flat: bool,
        selected: Option<&str>,
    ) -> Self {
        let mut model = Self {
            vw,
            vh,
            flat,
            windows: Vec::new(),
            filter: String::new(),
            selected: None,
            camera: Camera::default(),
            all: BTreeMap::new(),
            shown: Vec::new(),
            slots: BTreeMap::new(),
        };
        model.update(windows);
        model.selected = match selected {
            Some(id) if model.slots.contains_key(id) => Some(id.to_string()),
            _ => model.shown.first().map(|w| w.id.clone()),
        };
        model
    }

    pub fn flat(&self) -> bool {
        self.flat
    }

    pub fn filter(&self) -> &str {
        &self.filter
    }

    pub fn selected(&self) -> Option<&str> {
        self.selected.as_deref()
    }

    pub fn camera(&self) -> Camera {
        self.camera
    }

    /// Every window, in the order given.
    pub fn windows(&self) -> &[SpreadWindow] {
        &self.windows
    }

    /// The windows the filter lets through, in the spread's order: what the keys walk through.
    pub fn shown(&self) -> &[SpreadWindow] {
        &self.shown
    }

    /// A window's place: among the shown ones, else where it would be with no filter.
    pub fn slot_of(&self, id: &str) -> Option<Slot> {
        self.slots.get(id).or_else(|| self.all.get(id)).copied()
    }

    /// New windows or new places (the desk changed under the spread); filter and selection stay.
    pub fn update(&mut self, windows: Vec<SpreadWindow>) {
        self.all = self.layout(&windows).1;
        self.windows = windows;
        self.refilter();
    }

    /// Keep the windows whose title holds `text`; the selection stays when it still shows.
    pub fn set_filter(&mut self, text: &str) {
        self.filter = text.to_string();
        self.refilter();
    }

    /// Select a shown window; false when it is not shown or already selected.
    pub fn select(&mut self, id: &str) -> bool {
        if !self.slots.contains_key(id) || self.selected.as_deref() == Some(id) {
            return false;
        }
        self.selected = Some(id.to_string());
        true
    }

    /// Move the selection: along a row (on to the next row at its end), between rows, or in order.
    pub fn move_selection(&mut self, how: Move) -> bool {
        let len = self.shown.len();
        if len == 0 {
            return false;
        }
        let at = self
            .shown
            .iter()
            .position(|w| Some(w.id.as_str()) == self.selected.as_deref());
        let step = |by: usize| self.shown[(at.unwrap_or(0) + by) % len].id.clone();
        let next = match (at, how) {
            (None, _) | (_, Move::First) => Some(self.shown[0].id.clone()),
            (_, Move::Last) => Some(self.shown[len - 1].id.clone()),
            (_, Move::Next | Move::Right) => Some(step(1)),
            (_, Move::Previous | Move::Left) => Some(step(len - 1)),
            (Some(i), Move::Up) => self.vertical(&self.shown[i].id, -1),
            (Some(i), Move::Down) => self.vertical(&self.shown[i].id, 1),
        };
        match next {
            Some(id) => self.select(&id) || at.is_none(),
            None => false,
        }
    }

    /// What a key does: arrows, Tab, Home and End move; Enter chooses; Escape cancels.
    pub fn key(&mut self, key: &KeyPress) -> SpreadAction {
        let how = match key.key.as_str() {
            "Escape" => return SpreadAction::Cancel,
            "Enter" => {
                return match &self.selected {
                    Some(id) => SpreadAction::Choose { id: id.clone() },
                    None => SpreadAction::None,
                };
            }
            _ if key.meta || key.ctrl => return SpreadAction::None,
            "Tab" if key.shift => Move::Previous,
            "Tab" => Move::Next,
            "ArrowLeft" => Move::Left,
            "ArrowRight" => Move::Right,
            "ArrowUp" => Move::Up,
            "ArrowDown" => Move::Down,
            "Home" => Move::First,
            "End" => Move::Last,
            _ => return SpreadAction::None,
        };
        self.move_selection(how);
        self.keep_in_view();
        SpreadAction::Moved
    }

    /// A drag or the wheel on the scrim.
    pub fn pan(&mut self, dx: f64, dy: f64) {
        self.camera.x += dx;
        self.camera.y += dy;
    }

    /// Zoom by `factor` about the point `(x, y)` on screen, which stays where it is.
    pub fn zoom_at(&mut self, factor: f64, x: f64, y: f64) {
        let zoom = self.camera.zoom;
        let next = ZOOM_MAX.min(ZOOM_MIN.max(zoom * factor));
        let k = next / zoom;
        let (cx, cy) = (self.vw / 2.0, self.vh / 2.0);
        // The point's offset from the centre, less the pan, scales with the zoom.
        self.camera = Camera {
            zoom: next,
            x: x - cx - (x - cx - self.camera.x) * k,
            y: y - cy - (y - cy - self.camera.y) * k,
        };
    }

    /// Pan just enough to bring the selected card wholly into sight.
    pub fn keep_in_view(&mut self) {
        let Some(slot) = self.selected.as_ref().and_then(|id| self.slots.get(id)) else {
            return;
        };
        let r = self.on_screen(slot);
        let into = |start: f64, size: f64, room: f64| {
            if start < MARGIN {
                MARGIN - start
            } else if start + size > room - MARGIN {
                room - MARGIN - start - size
            } else {
                0.0
            }
        };
        let dx = into(r.x, r.w, self.vw);
        let dy = into(r.y, r.h, self.vh);
        if dx != 0.0 || dy != 0.0 {
            self.pan(dx, dy);
        }
    }

    /// The pose of every window by id: the shown ones in their places, the others faded where
    /// they were.
    pub fn poses(&self) -> BTreeMap<String, Pose> {
        self.windows
            .iter()
            .map(|w| (w.id.clone(), self.pose_of(w)))
            .collect()
    }

    pub fn pose_of(&self, w: &SpreadWindow) -> Pose {
        let shown = self.slots.contains_key(&w.id);
        let Some(slot) = self.slot_of(&w.id) else {
            return Pose {
                opacity: 0.0,
                ..IDENTITY
            };
        };
        let r = self.on_screen(&slot);
        let zoom = self.camera.zoom;
        let fit = (slot.w / w.rect.w).min(slot.h / w.rect.h).min(1.0) * zoom;
        let lifted = shown && self.selected.as_deref() == Some(w.id.as_str());
        let (cx, cy) = centre(&w.rect);
        // A lifted card comes forward and grows a little; a filtered-out one sinks and shrinks.
        let lift = if lifted && !self.flat { 56.0 } else { 0.0 };
        let grow = if lifted { 1.04 } else { 1.0 };
        let (back, shrink) = if shown { (0.0, 1.0) } else { (160.0, 0.85) };
        Pose {
            tx: round_to(r.x + r.w / 2.0 - cx, 2),
            ty: round_to(r.y + r.h / 2.0 - cy, 2),
            z: round_to(slot.z * zoom + lift - back, 2),
            rotate_y: slot.rotate_y,
            rotate_x: slot.rotate_x,
            scale: round_to(fit * grow * shrink, 4),
            opacity: if shown { 1.0 } else { 0.0 },
        }
    }

    /// Paint order: the slot's, the selected card above every other.
    pub fn order_of(&self, id: &str) -> i64 {
        let order = self.slot_of(id).map_or(0, |s| s.order);
        let lifted = if self.selected.as_deref() == Some(id) {
            1000
        } else {
            0
        };
        order + lifted
    }

    fn refilter(&mut self) {
        let q = fold(self.filter.trim());
        let shown: Vec<SpreadWindow> = if q.is_empty() {
            self.windows.clone()
        } else {
            let hit = |w: &&SpreadWindow| fold(&w.title).contains(&q);
            self.windows.iter().filter(hit).cloned().collect()
        };
        let (order, slots) = self.layout(&shown);
        let keep = self
            .selected
            .as_ref()
            .is_some_and(|id| slots.contains_key(id));
        if !keep {
            self.selected = order.first().map(|w| w.id.clone());
        }
        self.shown = order;
        self.slots = slots;
    }

    fn layout(&self, windows: &[SpreadWindow]) -> (Vec<SpreadWindow>, BTreeMap<String, Slot>) {
        let stage = spread_stage(self.vw, self.vh);
        let n = windows.len();
        let rows = if self.flat {
            row_sizes(n, grid_shape(n, stage, FLAT_GAP).cols)
        } else {
            fan_rows(n, stage)
        };
        let order = spread_order(windows, &rows);
        let places = spread_slots(order.len(), stage, self.flat);
        let slots = order
            .iter()
            .zip(places)
            .map(|(w, slot)| (w.id.clone(), slot))
            .collect();
        (order, slots)
    }

    /// The nearest card in the row above (`by` -1) or below (+1) the one with `id`.
    fn vertical(&self, id: &str, by: i64) -> Option<String> {
        let from = self.slots.get(id)?;
        let row = from.row as i64 + by;
        let x = from.x + from.w / 2.0;
        let mut best: Option<(&str, f64)> = None;
        for w in &self.shown {
            let Some(s) = self.slots.get(&w.id).filter(|s| s.row as i64 == row) else {
                continue;
            };
            let d = (s.x + s.w / 2.0 - x).abs();
            if best.is_none_or(|(_, nearest)| d < nearest) {
                best = Some((&w.id, d));
            }
        }
        best.map(|(id, _)| id.to_string())
    }

    /// A slot's box on screen through the camera (before perspective).
    fn on_screen(&self, slot: &Slot) -> Rect {
        let Camera { x, y, zoom } = self.camera;
        let (cx, cy) = (self.vw / 2.0, self.vh / 2.0);
        Rect::new(
            cx + (slot.x - cx) * zoom + x,
            cy + (slot.y - cy) * zoom + y,
            slot.w * zoom,
            slot.h * zoom,
        )
    }
}
