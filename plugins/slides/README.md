# plugins/slides

`endue.slides` ("Slides") opens every presentation in one viewer: a thumbnail rail, the slide scaled to
fit as real, selectable HTML, its speaker notes under it, and play mode. It reads; it never edits. The
community folder format on the public SDK only, like `plugins/notes`.

| Files | What it shows |
| --- | --- |
| `.pptx` `.pptm` `.ppsx` `.ppsm` `.potx` `.potm` | Full: layout and master inheritance, theme colours and fonts, preset shapes, fills, lines, text, pictures, tables, groups (a template without slides shows its layouts) |
| `.odp` `.otp` `.fodp` | Frames, text boxes, images, tables, shapes, master page backgrounds and shapes, notes |
| `.ppt` `.pps` `.pot` | Text only: each slide's title over its body, its pictures and notes |
| `.key` | The preview image in the package |
| `.gslides` | A card with the Google Slides address as selectable text |

One deck model (`ui/deck.js`) is what every reader makes and the one renderer (`ui/render/`) draws. A
damaged, encrypted or unknown file opens as the details view: name, size, format and why.

It answers `desk.files.visit`, `.revert`, `desk.buffers.show` and `.closed`; `desk.files.save` is refused
(read-only). It reads with `fs.read` as base64; outside its grants it asks once for the file's folder.
`fs.watch` on each open file runs `desk.files.changed { path }`.

| Permission | Why |
| --- | --- |
| `cmd:invoke` (`desk.files.changed`) | Tell the desk a file changed on disk |

Keys inside the surface: arrows, Page Up/Down, Home, End move between slides; F5 plays from the start,
Shift+F5 (or Play) from the slide on screen. In play mode Space, Right, Down and Page Down go on, Left, Up
and Page Up go back, a number then Enter jumps, Escape leaves. Chords always reach the desk.

| Folder | Purpose |
| --- | --- |
| `ui/pptx/`, `ui/odp/`, `ui/ppt/`, `ui/other.js` | The readers, on `ui/zip.js`, `ui/cfb.js` and `DOMParser` |
| `ui/slides.js`, `ui/view.js`, `ui/play.js` | Desk requests and fs calls; the DOM; play mode |

```bash
pnpm exec vitest run plugins/slides
cargo run -p desk-cli -- plugin validate plugins/slides
plugins/slides/tests/fixtures/make.sh   # rebuild the real-world fixtures (Docker)
```
