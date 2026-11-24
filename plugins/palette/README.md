# plugins/palette

`desk.palette` searches installed plugins, explicitly published plugin data, commands and the OS
index through the core bridge. Enter opens a result; arrows select; Escape closes. A separate native
window hosts the same UI above other apps, independently of profiles and the main endue window.

- **Global shortcut:** `Cmd+Shift+Space` (macOS), `Ctrl+Shift+Space` elsewhere; Settings › Keyboard
  changes it at once (`desk.palette.shortcut`), `DESK_PALETTE_SHORTCUT` wins, the tray opens it too.
- **In endue:** `Mod+K` opens the overlay and, pressed again, closes it; `desk.palette.pick` remains.
- **OS results:** macOS Spotlight (`mdfind`), Windows Search index, Linux `locate` (install and update
  its database). Only indexed paths are searched; a row shows the end of the file's folder, home as ~.
- **Plugin results:** every installed UI plugin can be launched, including disabled or closed ones.
  Only enabled plugins' published documents appear (Notes: open notes; Eris: recent exchanges).
- **Permissions:** `search:read` reads published documents; `search:system` queries/opens OS results.
  `search.replace` writes only the installed caller's own index. Private store values are never scanned.
- **Order:** the first row is the selected one until the arrows move it. Nothing typed: Recent (what
  was run or opened here, `desk.palette.history`, default 50), Plugins, then Commands A to Z. Typed:
  plugins and commands in one order, whole matches first, then the label (a plugin's name) before ids
  and keywords; OS results after. A command whose `argsSchema` requires args asks for each in turn
  (free text, or a pick of its `enum`); Enter runs it, Escape steps back one, then out.

Plugin authors publish through `ctx.search.replace([{ id, title, detail?, text?, command?, args? }])`.
Replacement is atomic and persists across restarts; `[]` clears it. Limit: 500 documents / 4 MiB per
plugin, 16,384 characters of searchable text per document. A command must start with the plugin id
and be registered by that plugin; its args arrive only on selection, after the plugin's UI opens.

| Command | Purpose |
| --- | --- |
| `desk.palette.open` | Search with optional `{ query }` |
| `desk.palette.pick` | `{ title, items: [{ id, label, detail }], free, query }`; resolves the id or cancels |
| `desk.palette.cancel` | Close and cancel any pending pick |

Providers (`contributes.paletteProviders`) group after the commands, the desk's Windows and Settings
(`desk.windows.find`, `desk.settings.find`) first; Enter runs the first action, Mod+Enter the second.
`desk.palette.items` searches the item index (`data.query`); stale replies drop; one OS query at a time.
```bash
pnpm exec vitest run plugins/palette plugins/notes packages/plugin-sdk/src/search.test.ts
cargo test -p desk-core --test search
just test-e2e palette.spec.ts palette-order.spec.ts
```
