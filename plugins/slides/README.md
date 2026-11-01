# plugins/slides

`endue.slides` ("Slides") opens every presentation in one viewer: a thumbnail rail, the slide scaled to
fit as real, selectable HTML, its speaker notes under it, and play mode. It reads; it never edits. The
community folder format on the public SDK only, like `plugins/notes`.

| Files | What it shows |
| --- | --- |
| `.pptx` `.pptm` `.ppsx` `.ppsm` `.potx` `.potm` | Full: layout and master inheritance, theme colours and fonts, preset shapes, fills, lines, text, pictures, tables, groups, links (a template without slides shows its layouts) |
| `.ppt` `.pps` `.pot` | Full, from the binary format: masters and their text styles, colour schemes, shapes and freeforms, solid, shaded and picture fills, lines, text with bullets and numbers, pictures (metafiles as labelled boxes), tables rebuilt from their shapes, groups, backgrounds, notes, hidden slides; links are coloured but do not open |
| `.odp` `.otp` `.fodp` | Frames, text boxes, images, tables, shapes, links, master page backgrounds and shapes, notes |
| `.key` | The preview image in the package |
| `.gslides` | A card with the Google Slides address as selectable text |

One deck model (`ui/deck.js`) is what every reader makes and the one renderer (`ui/render/`) draws. A
damaged, encrypted or unknown file opens as the details view: name, size, format and why.

It answers `desk.files.visit`, `.revert`, `desk.buffers.show` and `.closed`, and refuses `.save`. It
reads with the SDK's `readBytes` in ranges (`fs.url`, or ranged `fs.read`), asking once for a folder
outside its grants; `<desk-progress>` shows after 300 ms, and its Cancel keeps the deck on screen. Over
8 MiB a worker (`ui/worker.js`, with its own XML DOM) reads the deck and stays to decode its pictures.
http, https and mailto links open with `shell.open` (the core asks once for `shell:open`), a jump shows
its slide; links on the stage are named and in the tab order. `fs.watch` on each file runs
`desk.files.changed { path }` (`cmd:invoke`, the one permission the manifest declares).

Keys: arrows, Page Up/Down, Home, End move between slides, Enter follows a focused link; F5 plays from
the start, Shift+F5 (or Play) from the slide on screen. In play mode Space, Right, Down and Page Down go
on, Left, Up and Page Up go back, a number then Enter jumps, a click follows a link, Escape leaves.
Chords always reach the desk.

| Folder | Purpose |
| --- | --- |
| `ui/pptx/`, `ui/odp/`, `ui/ppt/`, `ui/other.js` | The readers, on `ui/zip.js`, `ui/cfb.js` and `DOMParser` |
| `ui/slides.js`, `ui/worker.js`, `ui/view.js`, `ui/play.js` | Desk requests, ranged reads, progress, links; the worker; the DOM; play mode |

```bash
pnpm exec vitest run plugins/slides
cargo run -p desk-cli -- plugin validate plugins/slides
plugins/slides/tests/fixtures/make.sh   # real-world fixtures (Docker); ppt/make.sh: the .ppt deck
```
