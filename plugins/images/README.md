# plugins/images

`endue.images` ("Images") opens every still image in one viewer, in the community folder format and
on the public SDK only. It shows; it never writes a file (`desk.files.save` is refused).

- This build's engine (Chromium, ADR 0143) decodes PNG, APNG, JPEG, GIF, WebP, AVIF, JPEG XL, BMP,
  ICO, CUR and SVG (SVGZ is gunzipped first; SVG goes into an `<img>`, so its scripts never run).
  It has no HEIC or TIFF decoder (ADR 0174): **HEIC does not show in this build**, and a phone's
  photo opens as the details view saying so, with Show in Finder for another app.
- Its own decoders, drawn to a canvas: uncompressed 8-bit RGB TIFF (as `sips` writes; other TIFFs
  open as details saying what they are), TGA, Netpbm (P1 to P7), QOI, DDS (BC1 to BC3), Radiance
  HDR and OpenEXR (tone-mapped), ICNS, KTX 1, DICOM, FITS and NIfTI-1 (Up and Down move slices);
  camera RAW, EPS, WMF and EMF their preview or bounds; damaged files open as details saying why.
- Viewer: fit by default, `Mod+=` / `Mod+-` / `Mod+0`, `Mod`+wheel at the pointer, drag or arrows
  to pan, rotate and flip for the view only, EXIF orientation applied. Left and Right (Page Up/Down,
  Home, End) walk the folder ("4 / 37"); Compare splits the surface (Escape or Compare again ends it
  or its chooser); a narrow toolbar scrolls sideways under the wheel. Details: format, sizes, colour,
  frames and EXIF (camera, lens, exposure, ISO, date, GPS...) from JPEG, PNG, WebP, HEIF, TIFF RAW.
- Asleep out of sight (ADR 0070, ADR 0176), the SDK's `keepFiles` keeps its files, watches and the
  view on screen; back, that image opens so, unasked and unfocused, the others when shown.

It reads with the SDK's `readBytes` (`fs.url` ranges, else `fs.read`), with a `<desk-progress>` bar
after 300 ms whose Cancel stops the read and the decoder. Over 8 MiB it decodes in a worker; webview
images get a `blob:` URL. Outside its grants it asks once for the file's folder (`<folder>/**`).

| Permission | Why |
| --- | --- |
| `cmd:invoke` (`desk.files.changed`, `desk.files.open`, `desk.buffers.close`) | Report changes on disk; walk the folder |
| `shell:open` (`${home}/**`) | Show in Finder on a details card (`ui/reveal.js`); elsewhere the core asks first |

| File | Purpose |
| --- | --- |
| `ui/images.js`, `opening.js`, `folder.js`, `keep.js` | Requests, compare; reads, one ask; the folder; a sleep |
| `ui/decode.js`, `sniff.js`, `decoding.js`, `worker.js` | Format by first bytes, one file to a model; a worker above 8 MiB |
| `ui/formats/` | The own decoders, EXIF, RAW previews, TIFF and ISO BMFF readers, header probes |
| `ui/view.js`, `viewer.js`, `compare.js`, `strip.js`, `paint.js`, `cards.js` | The DOM, keys, progress; zoom, pan, turn; Compare's chooser; the toolbar; bands; cards |

```bash
pnpm exec vitest run plugins/images      # python3 plugins/images/tests/make-fixtures.py rebuilds fixtures
```
