# Image Studio

`endue.image-studio` is a UI plugin for editing still PNG, JPEG and WebP images. In the launcher,
open Image Studio and choose a file. Add or duplicate layers, reorder them and change their
visibility or opacity. Choose Paint, Erase pixels, Hide with mask or Reveal with mask and drag on
the preview, or stamp the brush at exact canvas coordinates. Clear a layer's mask independently.
Apply other edits in the inspector, undo or redo a batch, and choose a separate file with Export
PNG. The raster workspace normalizes input to 8-bit sRGB RGBA
and supports up to 16 megapixels, 16,384 pixels per side and 32 MiB of encoded input.

The worker decodes input with the browser. The Rust engine crops, resizes, rotates, flips, adjusts
brightness, contrast and saturation, inverts, blurs and sharpens pixels. Geometry affects every
layer and mask. The engine composites up to eight layers within a 192 MiB raster budget, keeps up
to 12 undo steps within its history budget and encodes a flattened PNG. A draft can keep up to
2,048 operations and 1 MiB of edit instructions across a frame reload. Restoring it requires
the same source bytes and their read grant. Export a PNG to keep the result outside the session.

## Agent commands

| Command | Arguments and result |
| --- | --- |
| `endue.image-studio.open` | `{ path }` uses Image Studio's existing exact-path read grant. |
| `endue.image-studio.inspect` | Returns the document ID, revision, dimensions, layer IDs in bottom-to-top order and undo/redo availability. |
| `endue.image-studio.apply` | `{ document, revision, operations }`. Applies up to 16 operations as one batch. |
| `endue.image-studio.undo`, `endue.image-studio.redo` | `{ document, revision }`. Returns the new revision and dimensions. |

Layer operations are `add-layer`, `duplicate-layer`, `set-layer`, `move-layer`, `remove-layer`
and `reset-mask`. A `stroke` targets a layer with a radius, strength and up to 128 canvas points.
Paint also takes an RGB color. Filters take an optional layer ID.

The file picker gives Image Studio its read grant. The export dialog gives the plugin write access
to the selected destination. Images are processed locally in the sandboxed plugin worker.

```bash
node scripts/image-studio-wasm.mjs
cargo test -p desk-image-studio
pnpm exec vitest run plugins/image-studio
```
