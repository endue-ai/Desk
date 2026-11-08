---
status: accepted
date: 2026-11-01
decision-makers: Team endue
---

# The reader plugin draws PDFs with pdf.js, vendored into its folder

## Context and Problem Statement

`endue.reader` opens PDFs next to e-books and comics. Drawing a PDF means fonts (Type 1, TrueType,
CFF, Type 3), images (DCT, JBIG2, CCITT, JPX), shadings, transparency groups, encryption, broken
cross-reference tables and text extraction for selection and search. UI plugins are folders that run
as they are (ADR 0012) in a sandboxed frame with an opaque origin and the CSP `default-src 'none';
script-src desk-plugin: 'unsafe-inline'; connect-src 'none'`: no eval, no fetches, no Worker. Where
does the PDF engine come from, and how does it run inside that frame?

## Decision Drivers

* Production PDF rendering on the first day: writing a renderer is years of edge cases
* A plugin folder runs as it is (ADR 0012), with the frame's CSP unchanged
* One copy, reproducible from a pinned version, with its licence next to it
* The other formats (EPUB, MOBI, KF8, FB2, XPS, CBZ, CBT) stay the plugin's own code

## Considered Options

* Vendor pdf.js (`pdfjs-dist`, Apache-2.0) into `plugins/reader/ui/vendor/`, as ADR 0037 does xterm.js
* Serve pdf.js from the app at `/_desk/`, next to the SDK, for every plugin
* Render PDFs in the core (PDFium or MuPDF in Rust) and send page images over the bridge
* Write a PDF renderer of our own

## Decision Outcome

Chosen option: "vendor pdf.js into the plugin folder", because it runs in the frame as it is, the copy
is reproducible, and neither the desk's API nor its CSP grows for it.

* `plugins/reader/package.json` pins `pdfjs-dist` to 6.4.299. `node scripts/vendor-pdfjs.mjs` copies
  `build/pdf.min.mjs`, `build/pdf.worker.min.mjs`, the text and annotation layer rules of
  `web/pdf_viewer.css` (`pdf_layers.css`) and `LICENSE` into `ui/vendor/`, drops source-map comments
  and writes `VERSIONS`. `scripts/vendor-pdfjs.test.mjs` fails `just test-unit` when the copy differs.
* Within the CSP: `isEvalSupported: false`; no `cMapUrl`, `standardFontDataUrl`, `wasmUrl` or
  `iccUrl` (system fonts stand in, `useSystemFonts: true`); the bytes go in as `data`. The worker
  module is imported first, so pdf.js finds `globalThis.pdfjsWorker` and runs its worker in the
  frame's thread; it never tries a Worker from the opaque origin.
* pdf.js is loaded on the first PDF only (`ui/pdfjs.js`), and everything the reader does with it stays
  in `ui/formats/pdf.js` and `ui/pdf-paint.js`, so the engine is swapped in two files.
* `ui/vendor/` is third-party: biome leaves it alone, `.gitattributes` marks it `linguist-vendored`.

### Consequences

* Good, because PDFs render as Firefox renders them, with selectable text, links and annotations.
* Good, because a community plugin can do the same: the built-in sets the pattern again.
* Bad, because 1.7 MiB of third-party code is in the repository and updates are by hand.
* Bad, because without fetches CJK PDFs that rely on predefined CMaps may show substituted glyphs,
  and JPX images do not decode without pdf.js's WebAssembly decoder.
* Bad, because the worker shares the frame's thread: a heavy page can delay input in that frame
  (only that frame: the desk and other plugins run elsewhere).
* Bad, because the modern build needs current engines (`Promise.try`, `Map.prototype.getOrInsert`,
  `Math.sumPrecise`): the desk's WebKit has them; the tests fill them in for Node 22.

## More Information

`plugins/reader/README.md`, ADR 0012 (plugins run from their folder), ADR 0037 (xterm.js, the same
pattern), `scripts/vendor-pdfjs.mjs`.
