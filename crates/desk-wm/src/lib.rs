//! The desk's window manager as a model (#53, ADR 0140): ported from the web runtime
//! (`packages/runtime/src/surface`, `arrange`, `shell`, `desktops`, `buffers.ts`) with the same
//! behaviour and numbers. Plain data in, plain data out (`serde` types); no clock, no I/O and no
//! rendering, so the compositor, the core and the tests drive it alike. Each module names the TS
//! module it ports.
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
//! - `panes`: the pane tree and its dividers; `desktops`, `migrate`: the named list of desktops
//!   (ADR 0117) and what profiles and sessions stored; `layout`: a desktop's layout and the
//!   profile's saved ones; `drawer`, `buffers`: the drawer's items and the buffer list.
//! - `desk`: one `Desk` state holding all of it, its operations, and the `Arranger` (tile and
//!   cascade, ADR 0116); `snapshot`: what `desk.windows.list` answers, as the contract's
//!   `BrainDesk` (specs/bridge/v0, #82).
//! - `host`: what the compositor draws for the desktop in front (#81): the bars' bands and the free
//!   area, each window at its rectangle with its panes, the live budget, and the surfaces'
//!   lifecycle steps.
//! - `interact`: dragging, resizing, snapping, the pan and the window commands on the compositor's
//!   input (#80), and what the runtime takes back from them.

pub mod arrange;
pub mod buffers;
pub mod clearance;
pub mod coordinates;
pub mod cover;
pub mod desk;
pub mod desktops;
pub mod drawer;
pub mod fill;
pub mod geometry;
pub mod host;
pub mod interact;
pub mod layout;
mod math;
pub mod migrate;
pub mod minimap;
pub mod pan;
pub mod panes;
pub mod placed;
pub mod settle;
pub mod snap;
pub mod snapshot;
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
pub use desk::{
    ArrangeKind, Arranged, Arranger, Desk, InUse, Kept, Moved, OnRemove, Removal, Restored,
    default_placement,
};
pub use desktops::{Desktop, DesktopId, DesktopRef};
pub use drawer::{DrawerItem, DrawerKind};
pub use fill::{fill_with, snap_rect, toggle_floating, toggle_maximize, unfilled, unfilled_at};
pub use geometry::{
    BELOW_ERIS, FREE, MIN, REF, SAFE, clamp_rect, free_area, free_top, from_screen, screen_area,
    to_screen,
};
pub use host::{
    Bars, Decision, FrameDoc, FrameState, HostPane, HostWindow, LiveBudget, Places, Plan, Seat,
    Step, Surfaces,
};
pub use layout::{DesktopLayout, Saved, Visible};
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
pub use snapshot::{Frame, Seen, Unseen};
pub use spread::model::{Move, SpreadAction, SpreadModel};
pub use spread::pose::{Camera, IDENTITY, Pose, ZOOM_MAX, ZOOM_MIN, mix};
pub use spread::slots::{
    DEPTH, SPREAD_INSET, Slot, TURN, fan_rows, flat_slots, spread_slots, spread_stage,
};
pub use spread::windows::{SpreadWindow, asleep, spread_order};
pub use tiling::{CASCADE, GAP, free_slot, slot_rect, slot_rect_in, slot_windows};
pub use types::*;
