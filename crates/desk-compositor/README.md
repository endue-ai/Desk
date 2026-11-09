# desk-compositor

The desk's own compositor (#32 §3): a retained wgpu scene of a wallpaper, rectangles the desk draws
itself (frames, bars, previews) and surfaces other processes rendered into textures, drawn into a
`wgpu::TextureView` the caller owns. No windowing, no CEF: it runs inside any shell and headless.

## Public API

- `Scene::new(w, h)`: units are target pixels, origin top-left. `insert(parent, node)`, `set`,
  `remove`, `reorder` (draw order = children's order, last on top), `set_wallpaper`,
  `set_projection` (orthographic, or perspective for 3D tilts), `set_animating`, `to_screen`.
  Every change records its screen region: `revision()`, `damage_since(rev)`.
- Nodes are data: `RectNode { rect, fill, stroke, radius, shadow }`,
  `SurfaceNode { rect, texture, uv, opacity, radius }`, `GroupNode { transform: Mat4, opacity,
  clip }`; `Node::with_hit(false)` lets the pointer through a node or a whole subtree.
- `Compositor::new(&device, &queue, format)`; `register_texture` / `update_texture` (call it on
  every paint) / `remove_texture`; `render(&scene, &view, size) -> FrameStats` draws only when
  something was damaged or animates (`drawn`, `damage`, `compose_time`, `nodes_drawn`,
  `textures_resident`, `animating`). One compositor can draw several scenes (one per display).
- `hit_test(&scene, point) -> Option<Hit { node, local_point }>`: top-down, through inverse
  transforms (a ray for 3D), honouring clips and `hit`.
- `headless`: `headless_device()` (GPU or software adapter), `Target`, `read_rgba`, `upload_rgba`.

Colours are straight alpha in the target's encoding: use a non-sRGB format (BGRA8 or RGBA8).
Textures are premultiplied. Not yet: text (#51), CEF import (#52), shadow knockout, group opacity
as a layer (opacity multiplies into each child).

## Test

```bash
cargo test -p desk-compositor                      # unit, hit-test properties, render loop, snapshots
UPDATE_SNAPSHOTS=1 cargo test -p desk-compositor --test snapshots   # rewrite tests/snapshots/*.png
cargo run -p desk-compositor --release --example demo              # 15 moving windows, last frame as PNG
cargo bench -p desk-compositor --bench compose                     # 15 surfaces at 1440p vs 4 ms
```

GPU tests skip with a message when the machine has no adapter (`DESK_COMPOSITOR_REQUIRE_GPU=1`
makes that a failure). CI needs lavapipe on Linux (`mesa-vulkan-drivers`) or WARP on Windows.
