# plugins/explorer

`endue.explorer`, the folder view (Emacs's `dired`, VS Code's Explorer), in the community folder format
and on the public SDK only. One `left` surface shows the folders the person allows as a tree: folders
first in natural order, dotfiles on request, 500 entries a page. A file opens through `desk.files.open`,
so the plugin the desk's rules name reads it under its own grants; the explorer never reads a file.
Requirements, decisions and the road ahead: `docs/ko/explorer-requirements.md`.

Keyboard: the WAI-ARIA tree pattern. Arrows move, `→` expands or steps in, `←` collapses or steps out,
Home and End jump, Enter or Space opens, letters jump to the next matching name. Chords reach the desk.
Rows are draggable: a drop target reads the path as `text/plain` or `application/x-desk-path`.

A listing outside its grants is refused: the explorer asks with `perm.request` for that folder
(`<folder>/**`) and tries once more; a refusal is said in words on the row and the status line
(`Not allowed to list ~/Documents.`). Expanded folders are watched (`fs.watch`, 64 at most: v0 has no
unwatch) and listed again when they change. The expanded folders and the selection live in the store;
the folders, the dotfile choice and the page are settings (`endue.explorer.folders`, `.show-hidden`, `.page`).

| Permission | Why |
| --- | --- |
| `fs:read` (`${home}/**`) | List folders and watch them; asked per folder at first use |
| `fs:write` (`${home}/**`) | Create an empty file (New file); never overwrites one that exists |
| `cmd:invoke` (`desk.files.open`, `desk.buffers.list`, `desk.palette.pick`) | Open a file where the desk says, find the file in use, ask for a path or a name |

| Command | Key | Does |
| --- | --- | --- |
| `endue.explorer.open` | `Mod+Shift+E` | Show the explorer and focus the selection |
| `endue.explorer.reveal` | `Mod+Shift+R` | Expand down to the file in use, or to `{ path }` |
| `.refresh` · `.toggle-hidden` · `.add-folder` · `.remove-folder` · `.new-file` | | List again; dotfiles; a folder (`{ path }` or typed); a file (`{ folder, name }` or asked) |

| File | Purpose |
| --- | --- |
| `ui/tree.js` | Paths, the order of entries, the rows on screen, where a key moves the selection |
| `ui/disk.js` · `ui/desk.js` | fs.list, fs.write, fs.watch with one ask on a refusal; the desk's commands |
| `ui/explorer.js` | The tree's state, the plugin's commands, the store and the settings |
| `ui/view.js` · `ui/main.js` | The DOM (role=tree, roving tabindex, drag) and the mount |
```bash
pnpm exec vitest run plugins/explorer
cargo run -p desk-cli -- plugin validate plugins/explorer
```
