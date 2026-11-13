# desk-wm

The desk's window manager (#53, ADR 0140, ADR 0158), ported from the web runtime with its behaviour
and numbers: snap 24 px (8 at the top), corners 120 px, 12 px gaps, 32 px cascades. Plain `serde`
data; no clock (times are passed in), no I/O, no rendering. It reads and writes the runtime's JSON.

## Public API

- `types`, `layout`: `Rect`, `Placement` (normal or floating, `fill`, `restore`), `PaneNode`,
  `Adopted`; `DesktopLayout`, and `Saved`, what the profile in force saved.
- Geometry, snap and fill (ADR 0128, ADR 0132): `screen_rect`, `stored_rect`, `free_area`,
  `snap_for`, `Aim`, `fill_with`, `unfilled`, `own_floating`, `toggle_maximize`, `toggle_floating`, `Settle`; `within_reach`.
- Tiling and the spread (ADR 0040, ADR 0116): `slot_rect`, `slot_windows`, `tile_rects`, `cascade_rects`,
  `SpreadModel`, `spread_slots`, `fitted_stage`, `drawn_box`, `Spread` (on the caller's clock, ADR 0161); `covered_plugins`.
- Canvas (ADR 0082): `drag_pans`, `wheel_pan`, `PanDrag`; the map's `fit_world`, `map_shows`, `MapDrag`.
- `panes`: `split`, `close`, `set_view`, `set_ratio`, `key_ratio`, `drag_ratio`; `window_min`, `fit_panes`.
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
- `interact` (#80, ADR 0153): `Wm`, which holds the desk (#83, ADR 0158), on the compositor's input
  (`pressed`, `grab`, `moved`, `released`, `escape`, `run` an `Op`, `reveal`, `pan_to`, `cursor_at`, `frame`; `set_scale`, `pixels`: rests on whole device pixels, ADR 0209), the runtime's `edit`s
  (`edits::Edit`, the desktops' `undo`) and `took`; each change publishes the whole `Desk` with its
  `view::View` and the edits' answers (`Published`). `desk-wm-wasm` runs it where there is no compositor.

## Test

```bash
cargo test -p desk-wm
```

`tests/*.rs` port the TS tests case by case, by name (`describe` → module, `it` → function), each
header naming its source; `tests/scene.rs` and `desk-view.scene.test.ts` give one scene vector.
