# plugins/images

`endue.images` ("Images") opens every still image in one viewer, in the community folder format and
on the public SDK only. It shows; it never writes a file (`desk.files.save` is refused).

- The webview decodes PNG, APNG, JPEG, GIF, WebP, AVIF, BMP, ICO, CUR and SVG (SVGZ is gunzipped
  first), and HEIC, JPEG XL and TIFF where the platform's WebKit does; a file it cannot decode opens
  as the details view with that reason. SVG goes into an `<img>`, so its scripts never run.
- Its own decoders, drawn to a canvas: TGA, Netpbm (P1 to P7), QOI, DDS (BC1 to BC3), Radiance
  HDR and OpenEXR (tone-mapped), ICNS, KTX 1, DICOM, FITS and NIfTI-1 (Up and Down move slices).
- Camera RAW shows its largest embedded preview; EPS its TIFF or EPSI preview; WMF and EMF their
  bounds and record count. Damaged and unsupported files open as a details view saying why.
- Viewer: fit by default, `Mod+=` / `Mod+-` / `Mod+0`, `Mod`+wheel around the pointer, drag or
  arrows to pan when zoomed in, rotate and flip for the view only, the EXIF orientation applied.
  Left and Right (or Page Up/Down, Home, End) walk the folder in natural order ("4 / 37"), replacing
  the buffer; Compare splits the surface with another image, zoom and pan shared; Escape ends it.
- Details: format, pixel size, file size, colour, frames, and EXIF (camera, lens, exposure,
  aperture, ISO, focal length, date, GPS, software) from JPEG, PNG, WebP, HEIF and TIFF-based RAW.

It reads with `fs.read` as base64; outside its grants it asks once for the file's folder
(`<folder>/**`), then lists that folder with `fs.list`. The manifest declares no fs paths.

| Permission | Why |
| --- | --- |
| `cmd:invoke` (`desk.files.changed`, `desk.files.open`, `desk.buffers.close`) | Report changes on disk; walk the folder |

| File | Purpose |
| --- | --- |
| `ui/images.js` | The desk's requests, reads with one ask, the folder, compare; no DOM |
| `ui/decode.js`, `ui/sniff.js` | Format by first bytes then extension; one file to a model |
| `ui/formats/` | The own decoders, EXIF, RAW previews, TIFF and ISO BMFF readers, header probes |
| `ui/view.js`, `ui/viewer.js` | The DOM and keys; zoom, pan and turn without the DOM |
| `ui/paint.js` | The one module that draws (jsdom has no canvas) |

```bash
pnpm exec vitest run plugins/images      # python3 plugins/images/tests/make-fixtures.py rebuilds fixtures
cargo run -p desk-cli -- plugin validate plugins/images
```
