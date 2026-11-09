# Desk surface protocol v0

Everything on screen is a **surface**: a texture a process rendered, placed by the compositor
(ADR 0140). This is the one contract between the compositor and anything that draws a surface
(ADR 0141): the web host, which runs one off-screen CEF browser per surface (#52), and in Stage 3 a
native plugin's own process (#59). Nothing in it is specific to an engine: a message means the same
whoever draws.
v0 may break on any minor release (ADR 0004).

## Messages

A message is one JSON object with a `type` and the `surface` it is about. `CompositorMessage` is what
the compositor sends, `SurfaceMessage` what a surface sends; no type is sent both ways, so a type
names its direction. One connection may carry many surfaces: the compositor names each in `create`.
Messages about one surface keep their order; nothing is answered by id.

| Page | Schema | Compositor → surface | Surface → compositor |
| --- | --- | --- | --- |
| [lifecycle](lifecycle.md) | `lifecycle.schema.json` | `create`, `resize`, `show`, `hide`, `sleep`, `wake`, `destroy` | `ready`, `died`, `title` |
| [texture](texture.md) | `texture.schema.json` | `release`, `pace` | `attach`, `rate` |
| [input](input.md) | `input.schema.json`, `drag.schema.json` | `pointer.*`, `key.*`, `focus.*`, `drag.enter`, `drag.over`, `drag.leave`, `drag.drop`, `drag.ended` | `cursor`, `drag.accept`, `drag.start`, `drag.status`, `drag.done` |
| [ime](ime.md) | `ime.schema.json` | `ime.composition`, `ime.commit`, `ime.cancel` | `ime.enabled`, `ime.caret` |
| [accessibility](accessibility.md) | `accessibility.schema.json` | `a11y.enable`, `a11y.action` | `a11y.update` |

`surface.schema.json` holds the two unions and what the groups share: `SurfaceId`, `SurfaceSize`
(logical pixels), `SurfaceScale`, `SurfaceFormat`, `SurfaceRect` (logical), `SurfacePixelRect`
(texture pixels), `SurfaceModifiers` and `SurfaceTextRange` (UTF-16 code units).

## Units

- **Logical pixels** (CSS pixels, points) for sizes, input coordinates, carets and accessibility
  bounds, from the surface's top left. Pointer coordinates come after the compositor's own hit test
  and inverse transform, so a rotated or scaled window still hears its own coordinates.
- **Texture pixels** for textures and damage: logical size × scale, rounded.
- Colour is sRGB with premultiplied alpha, in `bgra8` or `rgba8`.

## Transport

The protocol says what a message holds, not how it travels. In the desk's own process (the web host
beside the compositor) messages are values of the generated types. Across processes (a native
plugin over its socket pair) each message is one JSON text; file descriptors (Linux) and Mach send
rights (macOS) travel **out of band** in the same transport message (`SCM_RIGHTS`, Mach port
descriptors), and the JSON names them by index (`fdIndex`, `portIndex`, `fenceFdIndex`, from 0). A
receiver closes every descriptor it was sent and did not keep.

## Types

`just codegen` writes `crates/desk-surface/src/generated.rs` and
`packages/bridge/src/surface.generated.ts` (exported by `@endue-ai/bridge`). `vectors/` holds valid
and invalid messages; `crates/desk-surface/tests/vectors.rs` and
`packages/bridge/src/surface.contract.test.ts` hold both sides to them.
