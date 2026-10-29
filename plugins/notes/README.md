# plugins/notes

`endue.notes`, the desk's first file opener, in the community folder format and on the public SDK
only. Its `contributes.files` rule opens `*.md` and `*.txt` (anywhere: the grants, not the rule, decide
where it reads without asking) in one plain text area on the grid; `Mod+O` with a path opens one.

It answers the desk's `desk.files.visit`, `.save` and `.revert` (`{ buffer, path }`) and
`desk.buffers.show` and `.closed` (`plugins/files`, `plugins/buffers`). Several notes can be open; the
text area shows one. The first edit after a load or save runs `desk.buffers.update { id, modified: true }`;
`fs.watch` on each open file runs `desk.files.changed { path }`, and `desk.files.on-change` decides.

A file outside its grants: `fs.read` or `fs.write` is refused, notes asks with `perm.request` for the
file's folder (`<folder>/**`) and tries once more. A refusal is said in words on its status line and in
the desk's notice: `Not allowed to read ~/Documents/x.md.`

| Permission | Why |
| --- | --- |
| `fs:read` (`${home}/Notes/**`) | Read notes and watch them for changes on disk |
| `fs:write` (`${home}/Notes/**`) | Save notes |
| `cmd:invoke` (`desk.files.changed`, `desk.buffers.update`) | Tell the desk a file changed on disk, or has unsaved changes |

| File | Purpose |
| --- | --- |
| `ui/notes.js` | The desk's requests, fs calls with one ask on refusal, watches, the unsaved mark |
| `ui/view.js` | The DOM: the file name, path and unsaved mark, the text area, a status live region |
| `ui/main.js` | Mounts the plugin and joins the view to the controller |

The text area is the only control and takes focus on show and visit; its name is the file name.
Chords are never prevented, so `Mod+S`, `Mod+O` and `Mod+W` reach the desk's keymap.

```bash
pnpm exec vitest run plugins/notes
cargo run -p desk-cli -- plugin validate plugins/notes
```
