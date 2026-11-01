# plugins/reader

`endue.reader` ("Reader"), the desk's reader for documents, e-books and comics, community format on
the public SDK only. It opens `*.pdf` `*.xps` `*.oxps` `*.epub` `*.mobi` `*.azw` `*.azw3` `*.prc`
`*.fb2` `*.cbz` `*.cbt` `*.cbr` `*.cb7` `*.djvu` `*.djv`, picked by first bytes, then extension.

PDF is pdf.js (`pdfjs-dist` 6.4.299, pinned in `package.json`, copied into `ui/vendor` by
`node scripts/vendor-pdfjs.mjs`, ADR 0042), its pages read by byte ranges in a real worker. EPUB,
MOBI and KF8, FB2, XPS and OXPS, CBZ and CBT are the plugin's own code. CBR, CB7 and DjVu come from the
library plugin `endue.formats` (import map `@endue-ai/formats/`), decoded in `ui/library-worker.js`
(by URL: import maps miss workers) or in the frame when none starts; a solid archive is decoded
once, in its order. Damaged, encrypted or DRM files open as details; it never writes. Book HTML is rebuilt
from an allowlist (no scripts, handlers or remote URLs) into a shadow root with the book's CSS.

It answers `desk.files.visit`, `.revert`, `desk.buffers.show` and `.closed` (`.save` is refused),
reads SDK byte ranges, asks once for a file's folder, follows files with `fs.watch`, and keeps
position, zoom, bookmarks and notes per path in its store, never in the file. Progress offers
Cancel, which stops every page being decoded; a stopped PDF or DjVu offers Reload document.

| File | Purpose |
| --- | --- |
| `ui/reader.js`, `ui/marks.js` | The desk's requests, reads with one ask, watches; marks in the store |
| `ui/open.js`, `ui/detect.js` | Sniffing and opening: a book, a password request or a details view |
| `ui/formats/` | The readers: zip, tar, pdf, epub, sanitize, css, palm, mobi, fb2, xps, archive-comic, djvu |
| `ui/library-*.js`, `ui/djvu-client.js` | The endue.formats worker, its client, DjVu documents in it |
| `ui/view.js`, `pages.js`, `chapters.js`, `side.js`, `find.js` | Toolbar, pages, chapters, panel, search |
| `ui/paint.js`, `ui/pdf-paint.js`, `ui/djvu-paint.js` | Images, SVG, PDF and DjVu canvases, text layers |

Keys: Mod+F, Mod+G (Shift: back) search, Mod+= Mod+- Mod+0 zoom, arrows Home End move, Escape
closes search or panel; Mod+S, Mod+O, Mod+W, Mod+K pass to the desk. `tests/build/make-cb7.mjs` remakes the CB7 fixture.

| Permission | Why |
| --- | --- |
| `cmd:invoke` (`desk.files.changed`); `fs:read` and `shell:open`, asked when needed | File changes; scoped reads; http, https and mailto links |

```bash
pnpm exec vitest run plugins/reader
python3 plugins/reader/tests/build/live.py /tmp/reader-large # 300 MiB PDF, 100 MiB EPUB
cargo run -p desk-cli -- plugin validate plugins/reader
```
