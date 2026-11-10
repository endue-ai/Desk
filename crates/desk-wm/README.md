# desk-wm

The desk's window manager as a model (#53, ADR 0140), ported from the web runtime
(`packages/runtime/src/surface`, `arrange`, `shell`) with the same behaviour and numbers: snap
distance 24 px (8 at the top), corners 120 px, 12 px gaps, the slots' and the cascade's 32 px step.
Plain `serde` data in and out; no clock, no I/O, no rendering, so the compositor, the core and tests
drive it alike. Placements read and write the runtime's saved JSON unchanged.

## Public API

- `types`: `Rect`, `Offset`, `Placement` (normal or floating, `fill`, `restore`), `Fill`, `PaneNode`
  (shape and `leaves` only), `Adopted`, `KeyPress`.
- Geometry: `to_screen`, `from_screen`, `clamp_rect`, `free_area`, `FREE`; `screen_rect` and
  `stored_rect` for the two coordinate spaces; `title_clearance` keeps a filled title clear of the
  top chips.
- Snap and fill (ADR 0128, ADR 0132): `snap_for`, `Aim` (a drag aims only once it left every zone),
  `fill_rect`, `fill_with`, `unfilled`, `toggle_maximize`, `toggle_floating`; `Settle`, the glide.
- Tiling (ADR 0040, ADR 0116): `slot_rect`, `free_slot`, `slot_windows`; `tile_rects`,
  `grid_shape`, `cascade_rects`, `arrange_area`.
- Spread (ADR 0116): `spread_slots`, `fan_rows`, `flat_slots`; `SpreadModel` (selection, filter,
  keys, camera, `poses`), `mix`, `asleep`.
- Out of sight (ADR 0070): `covered_plugins`, `z_of`, `shown_plugins`, `placed_plugins`.
- Canvas (ADR 0082): `drag_pans`, `wheel_pan`, `PanDrag`, `hint_shows`; the minimap's `world_of`,
  `fit_world`, `pan_centred_on`, `pan_by_key`.

Panes, desktops, focus and the drawer arrive with #79; pointer and key input with #80. The TS
modules stay until the compositor desk runs on this crate (#83).

## Test

```bash
cargo test -p desk-wm
```

`tests/*.rs` port the TS tests case by case, by name (`describe` → module, `it` → function); each
file's header names its source and the cases left to the wiring children.
