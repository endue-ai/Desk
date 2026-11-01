# plugins/explorer

`endue.explorer`, the folder view on the public SDK, uses one `left` surface for allowed folders:
first in natural order, dotfiles on request, 500 entries a page. A file opens through `desk.files.open`,
so the plugin the desk's rules name reads it under its own grants. Space shows a bounded quick preview.

Keyboard: the WAI-ARIA tree pattern. Arrows move, `→` expands or steps in, `←` collapses or steps out,
Home/End jump, Space previews, Enter opens, Escape closes the preview; letters jump by name.
One click selects; double click opens. Right-click or Shift+F10 offers Open, terminal, Git and system reveal.
Rows drag as `text/plain` or `application/x-desk-path`. Preview reads the first 64 KiB of UTF-8 text
or PNG/JPEG/GIF/WebP images up to 8 MiB; other files show details and Open. HTML is displayed as text.

A listing outside its grants is refused: the explorer asks with `perm.request` for that folder
(`<folder>/**`) and tries once more; a refusal is said in words on the row and the status line
(`Not allowed to list ~/Documents.`). Expanded folders are watched (`fs.watch`, 64 at most: v0 has no
unwatch) and listed again when they change. The expanded folders and the selection live in the store;
the folders, the dotfile choice and the page are settings (`endue.explorer.folders`, `.show-hidden`, `.page`).

| Permission | Why |
| --- | --- |
| `fs:read` (`${home}/**`) | List/watch folders and preview files; asked per folder at first use |
| `fs:write` (`${home}/**`) | Create an empty file (New file); never overwrites one that exists |
| `cmd:invoke` (`desk.files.open`, `desk.buffers.list`, `desk.palette.pick`, `endue.terminal.new`, `endue.git.status`) | Open files, find the current file, ask for a path, or continue in Terminal/Git |
| `shell:open` (paths only) | Reveal the selection in the system file manager; asks for the exact path |
| Command | Key | Does |
| --- | --- | --- |
| `endue.explorer.open` | `Mod+Shift+E` | Show the explorer and focus the selection |
| `endue.explorer.reveal` | `Mod+Shift+R` | Expand down to the file in use, or to `{ path }` |
| `.refresh` · `.toggle-hidden` · `.add-folder` · `.remove-folder` · `.new-file` | | List again; dotfiles; a folder (`{ path }` or typed); a file (`{ folder, name }` or asked) |
| `.open-selected` · `.terminal-here` · `.git-here` · `.show-in-file-manager` | Shift+F10 menu | Act on selection; terminal/Git use a file's parent. Missing providers and refused grants are reported |
| File | Purpose |
| --- | --- |
| `ui/tree.js` | Paths, the order of entries, the rows on screen, where a key moves the selection |
| `ui/disk.js` · `ui/desk.js` · `ui/explorer.js` | Scoped disk and desk calls, tree state, commands, store and settings |
| `ui/view.js` · `ui/main.js` · `ui/context-*.js` | Tree DOM, keyboard menu, selection actions and mount |
| `ui/preview.js` · `ui/preview-view.js` | Bounded preview reads, stale-result protection, URL cleanup and safe DOM |
```bash
pnpm exec vitest run plugins/explorer
cargo run -p desk-cli -- plugin validate plugins/explorer
```
