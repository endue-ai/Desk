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
- Viewer: fit by default, `Mod+=` / `Mod+-` / `Mod+0`, `Mod`+wheel at the pointer, drag or arrows
  to pan, rotate and flip for the view only, EXIF orientation applied. Left and Right (Page Up/Down,
  Home, End) walk the folder in natural order ("4 / 37"); Compare splits the surface (Escape ends).
- Details: format, pixel and file size, colour, frames, and EXIF (camera, lens, exposure, ISO,
  date, GPS...) from JPEG, PNG, WebP, HEIF and TIFF-based RAW.

It reads with the SDK's `readBytes` (binary ranges through `fs.url`, ranged `fs.read` without one),
with a `<desk-progress>` bar (Reading, then Decoding) after 300 ms whose Cancel stops the read and
the decoder and keeps the image on screen. Files over 8 MiB decode in a worker (`startWorker`);
images the webview decodes get a `blob:` URL; canvases fill a band at a time. Outside its grants
it asks once for the file's folder (`<folder>/**`), then lists it with `fs.list`.

| Permission | Why |
| --- | --- |
| `cmd:invoke` (`desk.files.changed`, `desk.files.open`, `desk.buffers.close`) | Report changes on disk; walk the folder |

| File | Purpose |
| --- | --- |
| `ui/images.js`, `ui/opening.js` | The desk's requests, the folder, compare; reads with one ask, Cancel |
| `ui/decoding.js`, `ui/worker.js` | In place up to 8 MiB, in a worker above; volumes keep theirs |
| `ui/decode.js`, `ui/sniff.js` | Format by first bytes then extension; one file to a model |
| `ui/formats/` | The own decoders, EXIF, RAW previews, TIFF and ISO BMFF readers, header probes |
| `ui/view.js`, `ui/viewer.js`, `ui/paint.js` | The DOM, keys and progress; zoom, pan, turn; drawing in bands |

```bash
pnpm exec vitest run plugins/images      # python3 plugins/images/tests/make-fixtures.py rebuilds fixtures
cargo run -p desk-cli -- plugin validate plugins/images
```
