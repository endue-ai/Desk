# desk-wm

The desk's window manager as a model (#53, ADR 0140), ported from the web runtime
(`packages/runtime/src/surface`, `arrange`, `shell`, `desktops`) with the same behaviour and
numbers: snap distance 24 px (8 at the top), corners 120 px, 12 px gaps, the 32 px cascades.
Plain `serde` data in and out; no clock (times are passed in), no I/O, no rendering. Layouts,
desktops, the drawer and the focus read and write the runtime's saved JSON unchanged.

## Public API

- `types`, `layout`: `Rect`, `Placement` (normal or floating, `fill`, `restore`), `PaneNode`,
  `Adopted`; `DesktopLayout`, and `Saved`, what the profile in force saved.
- Geometry, snap and fill (ADR 0128, ADR 0132): `screen_rect`, `stored_rect`, `free_area`,
  `snap_for`, `Aim`, `fill_with`, `unfilled`, `toggle_maximize`, `toggle_floating`, `Settle`.
- Tiling and the spread (ADR 0040, ADR 0116): `slot_rect`, `slot_windows`, `tile_rects`,
  `cascade_rects`, `SpreadModel`, `spread_slots`; out of sight (ADR 0070): `covered_plugins`, `z_of`.
- Canvas (ADR 0082): `drag_pans`, `wheel_pan`, `PanDrag`; the minimap's `fit_world`, `pan_by_key`.
- `panes`: `split`, `close`, `set_view`, `set_ratio`, the dividers' `key_ratio` and `drag_ratio`.
- `desktops`, `migrate` (ADR 0117): the named list of at most 32; `read_moved`, `read_recipe`,
  `read_pan`, `read_current` read what four-desktop desks saved; `write_moved` writes the list.
- `drawer`, `buffers`: `DrawerItem`, `recent_fade` and `shown` (12 h, 24 h); `Buffers`, by use.
- `Desk`, one state: `windows_of`, `layout_of`, `dirty`; `focus_pane`, `show_plugin`,
  `new_window`, `split`, `close_pane`, `close_window`, `snap_to`; `focus_order`, `focus_next`;
  `put_away`, `bring_back`, `switch_profile`; `add_desktop`, `remove_desktop`, `switch_to`,
  `move_to_desktop`, `move_back`. `Desk::set` keeps the drawer to what is away (#4).
- `Arranger` (tile, cascade, restore, ADR 0116); `Desk::snapshot` and `snapshot_seen` (titles and
  frames through `Seen`): what `desk.windows.list` answers, as the contract's `BrainDesk` (#82).
- `host` (#81, ADR 0151): `Desk::host_plan` and `host_plan_at` with `Places` (windows back to front,
  panes' boxes, bars, what the page draws), `LiveBudget` (ADR 0134) and `Surfaces`, the protocol steps.
- `interact` (#80, ADR 0153): `Wm` on the compositor's input (`pressed`, `grab`, `moved`, `released`,
  `escape`, `run` an `Op`, `frame`, `mirror`, `Published`); `Gesture`, `Grip`, `Motion`. TS stays to #83.

## Test

```bash
cargo test -p desk-wm
```

`tests/*.rs` port the TS tests case by case, by name (`describe` → module, `it` → function), each
header naming its source; `tests/scene.rs` and `desk-view.scene.test.ts` give one scene vector.
