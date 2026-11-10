//! The desk's window manager as a model (#53, ADR 0140): ported from the web runtime
//! (`packages/runtime/src/surface`, `arrange`, `shell`) with the same behaviour and numbers. Plain
//! data in, plain data out (`serde` types); no clock, no I/O and no rendering, so the compositor,
//! the core and the tests drive it alike. Each module names the TS module it ports.
//!
//! - `types`: the shared data (rects, placements, fills, panes' shape, keys).
//! - `geometry`, `coordinates`, `clearance`: the reference frame, the free area, normal and
//!   floating windows' spaces, a filled window's title clear of the top chips.
//! - `snap`, `settle`, `fill`: 8-way snap (ADR 0128), the glide into a part, filling and coming
//!   back.
//! - `tiling`, `arrange`: slots for unplaced windows (ADR 0040), tile and cascade (ADR 0116).
//! - `spread`: the spread's places, poses and model (ADR 0116).
//! - `cover`, `placed`: which plugins are out of sight (ADR 0070) and which a layout places.
//! - `pan`, `minimap`: the canvas pan and the canvas map (ADR 0082).

pub mod arrange;
pub mod clearance;
pub mod coordinates;
pub mod cover;
pub mod fill;
pub mod geometry;
mod math;
pub mod minimap;
pub mod pan;
pub mod placed;
pub mod settle;
pub mod snap;
pub mod spread;
pub mod tiling;
pub mod types;

pub use arrange::{
    GridShape, TARGET_ASPECT, arrange_area, cascade_rects, cascade_size, grid_shape, row_sizes,
    tile_rects,
};
pub use clearance::{TitleClearance, TopChrome, title_clearance};
pub use coordinates::{ORIGIN, is_floating, screen_rect, stored_rect};
pub use cover::{covered_plugins, z_of};
pub use fill::{fill_with, snap_rect, toggle_floating, toggle_maximize, unfilled, unfilled_at};
pub use geometry::{
    BELOW_ERIS, FREE, MIN, REF, SAFE, clamp_rect, free_area, free_top, from_screen, screen_area,
    to_screen,
};
pub use minimap::{
    Fit, MAP, fit_world, pan_by_key, pan_centred_on, pan_moved_by, to_map, to_world, view_rect,
    world_of,
};
pub use pan::{
    PanDrag, PanTarget, WheelMode, drag_pans, hint_shows, reset_shows, wheel_pan, wheel_pans,
};
pub use placed::{PLUGIN_VIEW, placed_plugins, resolve_view, shown_plugins};
pub use settle::{Glided, SETTLE_MS, Settle, SettleKind};
pub use snap::{Aim, CORNER, Halves, Rows, SNAP, SNAP_TOP, fill_rect, halves, rows, snap_for};
pub use spread::model::{Move, SpreadAction, SpreadModel};
pub use spread::pose::{Camera, IDENTITY, Pose, ZOOM_MAX, ZOOM_MIN, mix};
pub use spread::slots::{
    DEPTH, SPREAD_INSET, Slot, TURN, fan_rows, flat_slots, spread_slots, spread_stage,
};
pub use spread::windows::{SpreadWindow, asleep, spread_order};
pub use tiling::{CASCADE, GAP, free_slot, slot_rect, slot_rect_in, slot_windows};
pub use types::*;
