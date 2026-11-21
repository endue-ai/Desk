# plugins/notes

`endue.notes`, the desk's first file opener, on the public SDK only. Its `contributes.files` rule opens `*.md`
and `*.txt` (anywhere: the grants decide where it reads without asking) in a text area; `Mod+O` opens one.
It answers the desk's `desk.files.visit`, `.save` and `.revert` (`{ buffer, path }`) and
`desk.buffers.show` (a listed note it lost opens again) and `.closed`. Each note opens in a window of
its own (ADR 0212). The first edit after a load or save runs `desk.buffers.update { id, modified: true }`;
`fs.watch` on each open file runs `desk.files.changed { path }`, and `desk.files.on-change` decides.
Asleep out of sight (`ui.surface.state`, ADR 0070, ADR 0176), the SDK's `keepFiles` keeps its notes, watches,
caret, scroll and unsaved text (whole, or its change from the saved text); back, it neither asks nor takes the focus.
A dropped path becomes a link at the caret (ADR 0119; Markdown, relative to the note's folder, in a `.md` note), dropped
text goes in as text, and with no note open dropped files open; reading a dropped path still needs a grant.
New note (`endue.notes.new`, `Mod+Alt+N`) writes and opens an empty `~/Notes/<YYYY-MM-DD>.md` (`-2`, `-3`). Eris (ADR 0088, `ui/agent.js`) stays in `~/Notes`: `list { query }` and `read { path }` (the open copy when the person has it open), `new { text, name, open }`, `append` and `replace`, never over unsaved edits; each write keeps a version.
The shelf beside the note lists `~/Notes` (newest first, a filter, New) and opens a note in its window; a note in
`~/Notes` saves itself once typing pauses (others wait for `Mod+S`); Rename, Delete (twice, to the Trash), Preview.
Open… and Save as… (`.open`, `.save-as`) use `dialog.*`, granted that file alone. The last 30 open notes go
to search; other `*.md`/`*.txt` under `~/Notes` are the palette's Notes group (`endue.notes.find`), read when changed.

A file outside its grants: `fs.read` or `fs.write` is refused, notes asks with `perm.request` for the
file's folder (`<folder>/**`) and tries once more. A refusal is said in words on its status line and in
the desk's notice: `Not allowed to read ~/Documents/x.md.` The palette's group never asks.

| Permission | Why |
| --- | --- |
| `fs:read` (`${home}/Notes/**`) | Read and watch notes; list `~/Notes` for new names and the palette |
| `fs:write` (`${home}/Notes/**`) | Save notes and make new ones |
| `cmd:invoke` (`desk.files.changed`, `.open`, `desk.buffers.update`, `.switch`, `.close`, `endue.notes.new`) | Say a file changed or is unsaved; open, close and make notes |

| File | Purpose |
| --- | --- |
| `ui/notes.js`, `ui/grants.js` | The desk's requests, fs calls with one ask on refusal, watches, the unsaved mark |
| `ui/library.js`, `ui/search.js` | `~/Notes` on disk: new names, the palette's Notes group; open notes in search |
| `ui/view.js` | The DOM: the file name, path and unsaved mark, the text area, a status live region |
| `ui/counter.js` | Word and character counts in a worker (`ui/count-worker.js`), never on the frame's thread (#38) |
| `ui/keep.js` | What notes keeps when the desk puts it to sleep, and reading that back |
| `ui/drops.js` | Drops: paths as links (or opened), text at the caret; `ui/main.js` mounts it all |
| `ui/shelf.js`, `ui/shelf-view.js` | The shelf of `~/Notes`, auto-save, rename, delete, and the Markdown preview |

The text area is the only control and takes focus on show and visit; its name is the file name. Chords are never prevented, so `Mod+S`, `Mod+O` and `Mod+W` reach the desk's keymap.
`pnpm exec vitest run plugins/notes` · `cargo run -p desk-cli -- plugin validate plugins/notes`
