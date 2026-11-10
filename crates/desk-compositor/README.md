# desk-compositor

The desk's own compositor (#32 §3): a retained wgpu scene of a wallpaper, the desk's own chrome and text,
and surfaces other processes rendered, drawn into a `wgpu::TextureView` the caller owns; it routes their
input too. No windowing, no CEF: it runs inside any shell and headless.

## Public API

- `Scene::new(w, h)` (target pixels, origin top-left): `insert(parent, node)`, `set`, `remove`, `reorder`,
  `set_wallpaper`, `set_projection` (or perspective for 3D), `set_animating`, `to_screen`, `damage_since(rev)`.
- Nodes are data: `RectNode { rect, fill, stroke, radius, shadow }`, `SurfaceNode { rect, texture, uv,
  opacity, radius }`, `GroupNode { transform: Mat4, opacity, clip }`, `TextNode { rect, text, style, wrap }`
  (one line with an ellipsis, or wrapped); `Node::with_hit(false)` lets the pointer through a subtree.
- `Compositor::new(&device, &queue, format)`; `register_texture` / `update_texture` / `remove_texture`;
  `set_fonts(Fonts::system() | Fonts::from_data(..))`; `render(&scene, &view, size) -> FrameStats` draws
  only when something was damaged or animates. One compositor can draw several scenes (one per display).
- `Frames::attach(&mut compositor, id, &SurfaceAttach, Source)`: a `specs/surface` frame into its texture.
- Text and look (ADR 0146): cosmic-text with Latin, Hangul, CJK and emoji fallback, glyphs in an atlas;
  `Tokens` is `theme.tokens`' flat table (follows `var()`), `ChromeTheme::from_tokens` maps it to parts;
  `Chrome` builds windows, bars, snap previews, toasts and cards, `clear_title`, `set_theme` restyles all.
- `hit_test(&scene, point) -> Option<Hit>`; `headless`: `headless_device()`, `Target`, `read_rgba`.
- `input` (ADR 0150): `InputRouter::handle(&scene, &Input, now) -> Vec<Out>`, winit-like events to the
  surfaces in their own pixels, the keymap (ADR 0118) first; `surface_message`; ADR 0119's broker.
- `a11y` (ADR 0155): `DeskA11y` keeps the chrome (`DeskChrome`) and each surface's `a11y.update`, grafted
  where it is drawn; `flush` answers AccessKit updates an adapter takes, `request` an assistive ask.

Straight-alpha colours, premultiplied textures. Not yet: D3D11/DMA-BUF import (#61), shadow knockout,
group opacity as a layer, a theme's fonts and backdrops in chrome.

## Test

```bash
cargo test -p desk-compositor   # unit, hit, snapshots, text, looks, attach, input, a11y trees and properties
cargo run -p desk-compositor --release --example demo  # 15 titled windows, endue → amber live
just perf-compositor            # 15 surfaces at 1440p within 4 ms, the starts (cargo bench --bench compose)
```

Text tests use `tests/fonts` (OFL); looks the bridge's `theme-tokens-request*.json`. Snapshots match per
platform and adapter (`tests/support/tolerance.rs`, `UPDATE_SNAPSHOTS=1` rewrites); GPU tests share a device
and skip without one (`DESK_COMPOSITOR_REQUIRE_GPU=1` fails; `DESK_COMPOSITOR_ADAPTER=software`: lavapipe, WARP).
