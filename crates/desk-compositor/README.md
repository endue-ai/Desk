# desk-compositor

The desk's own compositor (#32 §3): a retained wgpu scene of a wallpaper, chrome the desk draws itself
(frames, title bars, bars, previews, toasts, text) and surfaces other processes rendered into textures,
drawn into a `wgpu::TextureView` the caller owns. No windowing, no CEF: it runs inside any shell and headless.

## Public API

- `Scene::new(w, h)`: units are target pixels, origin top-left. `insert(parent, node)`, `set`, `remove`,
  `reorder` (last child on top), `set_wallpaper`, `set_projection`, `set_animating`, `to_screen`. Every
  change records its screen region: `revision()`, `damage_since(rev)`.
- Nodes are data: `RectNode { rect, fill, stroke, radius, shadow }`, `SurfaceNode { rect, texture, uv,
  opacity, radius }`, `GroupNode { transform: Mat4, opacity, clip }`, `TextNode { rect, text, style, wrap }`
  (one line with an ellipsis, or wrapped; `TextStyle { font: FontStack, size, weight, color, .. }`).
- `Compositor::new(&device, &queue, format)`; `register_texture` / `update_texture` / `remove_texture`;
  `set_fonts(Fonts::system() | Fonts::from_data(..))` (the machine's load with the first text otherwise);
  `render(&scene, &view, size) -> FrameStats` draws only when something was damaged or animates.
- Text (ADR 0146): cosmic-text shapes and falls back across Latin, Hangul, CJK and emoji; glyphs keep
  their subpixel bin and live in the compositor's atlas (`glyphs_resident`, `atlas_side`).
- Look (ADR 0146): `Tokens` is the flat table `theme.tokens` carries (follows `var()`); `ChromeTheme::
  from_tokens` maps it to parts; `Chrome` builds windows, bars, snap previews, toasts and placeholders
  and `set_theme` restyles them all in one pass, so the next frame shows the new look.
- `hit_test(&scene, point) -> Option<Hit>`; `headless`: `headless_device()`, `Target`, `read_rgba`.

Colours are straight alpha in the target's encoding (use BGRA8 or RGBA8 Unorm); textures are
premultiplied. Not yet: CEF import (#52), shadow knockout, group opacity as a layer, theme `.woff2`
fonts and backdrop images in chrome.

## Test

```bash
cargo test -p desk-compositor                      # unit, hit tests, render loop, text, two looks
UPDATE_SNAPSHOTS=1 cargo test -p desk-compositor --test snapshots --test theme_snapshots
cargo run -p desk-compositor --release --example demo  # 15 titled windows, endue → amber live
cargo bench -p desk-compositor --bench compose         # 15 titled surfaces at 1440p vs 4 ms
```

Text tests use only `tests/fonts` (OFL subsets, `SOURCE.md`); looks come from the bridge's
`theme-tokens-request*.json` vectors. GPU tests skip without an adapter (`DESK_COMPOSITOR_REQUIRE_GPU=1`
fails instead); CI needs lavapipe on Linux (`mesa-vulkan-drivers`) or WARP on Windows.
