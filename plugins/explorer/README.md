# plugins/explorer

`endue.explorer`, the folder view on the public SDK, uses one `left` surface for allowed folders:
first in natural order, dotfiles on request, 500 entries a page. A file opens through `desk.files.open`: the plugin the desk's rules name reads it, given its folder first, so opening never asks (ADR 0131).
Space shows a bounded quick preview. Each row's icon says what it is (folder, code, image, archive, ...) in the theme's colours.

Keyboard: the WAI-ARIA tree pattern. Arrows move, `→` expands or steps in, `←` collapses or steps out,
Home/End jump, Space previews, Enter opens, Escape closes the preview; letters jump by name; F2 renames, Delete or Cmd+Backspace trashes.
One click selects and opens a file or toggles a folder; rows never select their text, and a row drags its path (`desk/paths`, ADR 0119) past 6 px. Right-click or Shift+F10 offers Open, terminal, Git, system reveal, Copy path, New file, New folder, Rename and Move to Trash.
Each change asks one question in the palette (the name, from the old one for Rename; Move to Trash every time), never overwrites, and is one `fs.write`, `fs.mkdir`, `fs.rename` or `fs.trash` (ADR 0125): the desk's undo takes back a rename or a new folder, the OS Trash keeps what is trashed. The explorer's own folders are never renamed or trashed.
A drop on a folder moves there (`fs.rename`; Alt, the OS or another volume copy with `fs.copy`); a taken name asks
to keep both, replace (the old one goes to the Trash) or skip; a container's file (`docker/file`) copies in through Docker's `endue.docker.copy-out`. Preview: 64 KiB of UTF-8 text, or images to 8 MiB.

A listing outside its grants is refused: the explorer asks with `perm.request` for that folder (`<folder>/**`)
and tries once more; a refusal is said in words on the row and the status line (`Not allowed to list
~/Documents.`); drops ask the same way. Expanded folders are watched (`fs.watch`, 64 at most) and listed again
when they change; expanded folders and the selection live in the store, the rest in settings (`endue.explorer.*`).

| Permission | Why |
| --- | --- |
| `fs:read` (`${home}/**`) | List/watch folders and preview files; asked per folder at first use |
| `fs:write` (`${home}/**`) | New file, New folder, Rename, Move to Trash; move, copy or trash dropped paths; never overwrites |
| `cmd:invoke` (`desk.files.open`, `desk.buffers.list`, `desk.palette.pick`, `endue.terminal.new`, `endue.git.status`) | Open files, find the current file, ask for a path, or continue in Terminal/Git; `endue.docker.copy-out` is asked for once, at the first container file dropped |
| `shell:open` (paths only) | Reveal the selection in the system file manager; asks for the exact path |
| Command | Key | Does |
| --- | --- | --- |
| `endue.explorer.open` | `Mod+Shift+E` | Show the explorer and focus the selection |
| `endue.explorer.reveal` | `Mod+Shift+R` | Expand down to the file in use, or to `{ path }` |
| `.refresh` · `.toggle-hidden` · `.add-folder` · `.remove-folder` · `.new-file` · `.new-folder` | | List again; dotfiles; a root (`{ path }` or typed); a file or folder (`{ folder, name }` or asked) |
| `.open-selected` · `.copy-path` · `.terminal-here` · `.git-here` · `.show-in-file-manager` · `.rename` · `.trash` | menu; F2; Delete | Act on selection, or `{ path }` (and `{ name }` for Rename); terminal/Git use a file's parent. Missing providers and refused grants are reported |
| File | Purpose |
| --- | --- |
| `ui/tree.js` · `ui/file-icons.js` · `ui/glyphs.js` | Paths, the order of entries, the rows on screen, where a key moves the selection; each row's icon (glyph and theme tone by kind, name and extension) as inline SVG |
| `ui/disk.js` · `ui/desk.js` · `ui/drops.js` · `ui/edits.js` · `ui/explorer.js` · `ui/command-registry.js` | Scoped disk and desk calls, drops on folders, edits on disk, tree state, commands, store and settings |
| `ui/view.js` · `ui/main.js` · `ui/context-*.js` · `ui/size.js` · `ui/style.css` | Tree DOM, keyboard menu, selection actions and mount; the look, from the theme's `--desk-*` tokens only |
| `ui/preview.js` · `ui/preview-view.js` | Bounded preview reads, stale-result protection, URL cleanup and safe DOM |
```bash
pnpm exec vitest run plugins/explorer
cargo run -p desk-cli -- plugin validate plugins/explorer
```
