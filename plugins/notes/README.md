# plugins/notes

`endue.notes`, the desk's first file opener, in the community folder format and on the public SDK
only. Its `contributes.files` rule opens `*.md` and `*.txt` (anywhere: the grants, not the rule, decide
where it reads without asking) in one plain text area on the grid; `Mod+O` with a path opens one.

It answers the desk's `desk.files.visit`, `.save` and `.revert` (`{ buffer, path }`) and
`desk.buffers.show` and `.closed` (`plugins/files`, `plugins/buffers`). Several notes can be open; the
text area shows one. The first edit after a load or save runs `desk.buffers.update { id, modified: true }`;
`fs.watch` on each open file runs `desk.files.changed { path }`, and `desk.files.on-change` decides.
When the desk unloads it out of sight (`ui.surface.state`, ADR 0070) it keeps the open notes, unsaved
text, watches, the note on screen, caret and scroll, and comes back from them without taking the focus.
A dropped path becomes a link at the caret (ADR 0119; Markdown, relative to the note's folder, in a `.md` note), dropped
text goes in as text, and with no note open dropped files open; reading a dropped path still needs a grant.
New note (`endue.notes.new`, `Mod+Alt+N`) writes an empty `~/Notes/<YYYY-MM-DD>.md`, `-2`, `-3` on the
same day, and opens it. Open notes (the last 30) go to search; every other `*.md` and `*.txt` under
`~/Notes` is the palette's Notes group (`endue.notes.find`) by name and text, read again only when changed.

A file outside its grants: `fs.read` or `fs.write` is refused, notes asks with `perm.request` for the
file's folder (`<folder>/**`) and tries once more. A refusal is said in words on its status line and in
the desk's notice: `Not allowed to read ~/Documents/x.md.` The palette's group never asks.

| Permission | Why |
| --- | --- |
| `fs:read` (`${home}/Notes/**`) | Read and watch notes; list `~/Notes` for new names and the palette |
| `fs:write` (`${home}/Notes/**`) | Save notes and make new ones |
| `cmd:invoke` (`desk.files.changed`, `.open`, `desk.buffers.update`, `.switch`) | Say a file changed or is unsaved; open a note |

| File | Purpose |
| --- | --- |
| `ui/notes.js` | The desk's requests, fs calls with one ask on refusal, watches, the unsaved mark |
| `ui/library.js` | `~/Notes` on disk: a new note's name, the palette's Notes group and what it read |
| `ui/view.js` | The DOM: the file name, path and unsaved mark, the text area, a status live region |
| `ui/counter.js` | Word and character counts in a worker (`ui/count-worker.js`), never on the frame's thread (#38) |
| `ui/keep.js` | What notes keeps when the desk unloads it, and reading that back |
| `ui/drops.js` | Drops: paths as links (or opened), text at the caret |
| `ui/main.js` | Mounts the plugin and joins the view to the controller |

The text area is the only control and takes focus on show and visit; its name is the file name. Chords are never prevented, so `Mod+S`, `Mod+O` and `Mod+W` reach the desk's keymap.
`pnpm exec vitest run plugins/notes` · `cargo run -p desk-cli -- plugin validate plugins/notes`
