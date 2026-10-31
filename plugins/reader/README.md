# plugins/reader

`endue.reader` ("Reader"), the desk's reader for fixed-layout documents, e-books and comics, in the
community folder format and on the public SDK only. `contributes.files` opens `*.pdf` `*.xps` `*.oxps`
`*.epub` `*.mobi` `*.azw` `*.azw3` `*.prc` `*.fb2` `*.cbz` `*.cbt` `*.cbr` `*.cb7` `*.djvu` `*.djv`.
The first bytes pick the reader, then the extension. It reads; it never writes the file.

PDF is pdf.js (`pdfjs-dist` 6.4.299, pinned in `package.json`, copied into `ui/vendor` by
`node scripts/vendor-pdfjs.mjs`, ADR 0042), inside the frame's CSP: no eval, no fetches (system fonts
stand in for CMaps and standard fonts), its worker in the frame. EPUB 2 and 3, MOBI 6 and KF8
(PalmDOC, HUFF/CDIC), FB2, XPS and OXPS (pages as SVG, `.odttf` fonts de-obfuscated), CBZ and CBT
are the plugin's own code. CBR, CB7 and DjVu open as details with their page counts; so does
anything damaged, encrypted or with DRM. Book HTML is rebuilt from an allowlist (no scripts,
handlers or remote URLs) into a shadow root with the book's CSS.

It answers `desk.files.visit`, `.revert`, `desk.buffers.show` and `.closed`; `.save` is refused.
It reads with `fs.read` (base64), asks once with `perm.request` for a file's folder, follows files
with `fs.watch` (`desk.files.changed`), and keeps position, zoom, bookmarks and notes per path in
its store (`store.set`), never in the file.

| File | Purpose |
| --- | --- |
| `ui/reader.js`, `ui/marks.js` | The desk's requests, reads with one ask, watches; marks in the store |
| `ui/open.js`, `ui/detect.js` | Sniffing and opening: a book, a password request or a details view |
| `ui/formats/` | The readers: zip, tar, pdf (pdf.js), epub, sanitize, css, palm, indx, mobi, kf8, fb2, xps |
| `ui/view.js`, `pages.js`, `chapters.js`, `side.js`, `find.js` | Toolbar, pages, chapters, panel, search |
| `ui/paint.js`, `ui/pdf-paint.js` | Drawing images, SVG and PDF canvases with their text layers |

Keys: Mod+F and Mod+G (Shift for back) search, Mod+= Mod+- Mod+0 zoom, arrows Home End move,
Escape closes the search or the panel. The desk's chords (Mod+S, Mod+O, Mod+W, Mod+K) pass.

| Permission | Why |
| --- | --- |
| `cmd:invoke` (`desk.files.changed`) | Tell the desk a file changed on disk |

```bash
pnpm exec vitest run plugins/reader
node --test scripts/vendor-pdfjs.test.mjs
cargo run -p desk-cli -- plugin validate plugins/reader
```
