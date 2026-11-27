# Image Studio

`endue.image-studio` is a UI plugin for editing still PNG, JPEG and WebP images. In the launcher,
open Image Studio and choose a file. Apply edits in the inspector, undo or redo a batch, and use
Export PNG to choose a separate file. The raster workspace normalizes input to 8-bit sRGB RGBA
and supports up to 16 megapixels, 16,384 pixels per side and 32 MiB of encoded input.

The worker decodes input with the browser. The Rust engine crops, resizes, rotates, flips, adjusts
brightness, contrast and saturation, inverts, blurs and sharpens pixels. It renders a fit preview,
keeps up to 12 undo steps within its memory budget and encodes PNG. The editor can replay up to
256 operations after Desk unloads a hidden window, while the source file and its read grant remain
available. Export a PNG to keep the result outside the open session.

## Agent commands

| Command | Arguments and result |
| --- | --- |
| `endue.image-studio.open` | `{ path }` uses Image Studio's existing exact-path read grant. |
| `endue.image-studio.inspect` | Returns the document ID, revision, dimensions and undo/redo availability. |
| `endue.image-studio.apply` | `{ document, revision, operations }`. Applies up to 16 operations as one batch. |
| `endue.image-studio.undo`, `endue.image-studio.redo` | `{ document, revision }`. Returns the new revision and dimensions. |

The file picker gives Image Studio its read grant. The export dialog gives the plugin write access
to the selected destination. Images are processed locally in the sandboxed plugin worker.

```bash
node scripts/image-studio-wasm.mjs
cargo test -p desk-image-studio
pnpm exec vitest run plugins/image-studio
```
