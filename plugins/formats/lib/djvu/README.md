# djvu: DjVu decoding for endue.formats

Shows DjVu books as pages, text and an outline. Plain ES modules: no SDK, no DOM; pages come back
as RGBA buffers, so a plugin can draw them on a canvas or hand them to a worker.

## Public API

`openDjvu(source, { resolve? })` from `index.js`, where `source` is `{ size, read(offset, length) }`,
answers:

- `title?`: the document's metadata title; `note?`: the sentence an incomplete document needs.
- `pages`: `{ width, height, dpi, rotation, missing? }[]`, sizes as shown after the page's rotation
  (degrees clockwise); `missing` names the separate file an indirect document keeps the page in.
- `renderPage(index, { scale, signal })` -> `{ width, height, rgba, note? }`: the page composed as
  DjVu does (IW44 background, JB2 mask painted with the FG44 image or FGbz colours, black on white
  for bitonal pages), turned and gamma-corrected. `scale` (0 to 1) uses IW44's coarser scales.
- `pageText(index)` -> the hidden text (TXTa, TXTz) in reading order, or `null`.
- `outline()` -> `{ title, url, page, children }[]` from NAVM; `page` is the 0-based target.

Containers: FORM:DJVU, FORM:PM44 and BM44, bundled FORM:DJVM (DIRM, INCL, shared Djbz) and indirect
documents (`resolve(name)` opens the files beside the index). Codecs: the Z'-coder (`zp.js`), BZZ,
JB2 with dictionaries and refinement, IW44 with progressive chunks and chroma delay. Not decoded:
Smmr (Fax G4), BGjp and FGjp (JPEG) layers, which `note` names. Damaged data fails with a sentence;
long work yields every 25 ms and stops with an AbortError when `signal` fires.

## Provenance

Written from the DjVu v3 specification (LizardTech, 2005) and the DjVu2 specification (AT&T,
1999), never from DjVuLibre's source. Where the printed specification and files made by the
reference encoder disagree, the code follows the files and says so (`zp.js`, `jb2-number.js`).

## Tests

`pnpm exec vitest run plugins/formats/tests/djvu`. The fixtures are rebuilt with
`node plugins/formats/tests/djvu/build/make-fixtures.mjs` (Docker; DjVuLibre's c44, cjb2, cpaldjvu,
djvumake, djvm, djvused and bzz, and minidjvu, encode generated images and text).
