# plugins/palette

`desk.palette` searches installed plugins, explicitly published plugin data, commands and the OS
index through the core bridge. Enter opens a result; arrows select; Escape closes. A separate native
window hosts the same UI above other apps, independently of profiles and the main Desk window.

- **Global shortcut:** `Cmd+Shift+Space` on macOS, `Ctrl+Shift+Space` elsewhere. Set
  `DESK_PALETTE_SHORTCUT` before startup to override it. The tray's **Search Desk** also opens it.
- **In Desk:** `Mod+K` opens the overlay; the existing `desk.palette.pick` API remains available.
- **OS results:** macOS Spotlight (`mdfind`), Windows Search index, Linux `locate` (install and update
  its database). Only indexed paths are searched. OS privacy/index exclusions still apply.
- **Plugin results:** every installed UI plugin can be launched, including disabled or closed ones.
  Only enabled plugins' published documents appear. Notes publishes open notes; Eris publishes recent completed exchanges.
- **Permissions:** `search:read` reads published documents; `search:system` queries/opens OS results.
  `search.replace` writes only the installed caller's own index. Private store values are never scanned.
- **Actions:** the core gives OS results short-lived, caller-bound ids. Plugins register their own
  result command and receive its args only on selection. Failures stay visible in the palette.

Plugin authors publish through `ctx.search.replace([{ id, title, detail?, text?, command?, args? }])`.
Replacement is atomic and persists across restarts; `[]` clears it. Limit: 500 documents / 4 MiB per
plugin, 16,384 characters of searchable text per document. A command must start with the plugin id
and be registered by that plugin. The palette opens its UI before invoking the command.

| Command | Purpose |
| --- | --- |
| `desk.palette.open` | Search with optional `{ query }` |
| `desk.palette.pick` | `{ title, items: [{ id, label, detail }], free }`; resolves the id or cancels |
| `desk.palette.cancel` | Close and cancel any pending pick |

Providers from `contributes.paletteProviders` remain grouped; Enter runs the first action,
Mod+Enter the second. `desk.palette.items` searches the shared item index through `data.query`.

History keeps up to `desk.palette.history` command ids (default 50). Async sources are debounced;
stale replies are discarded and at most one OS request runs per palette at a time.

```bash
pnpm exec vitest run plugins/palette plugins/notes packages/plugin-sdk/src/search.test.ts
cargo test -p desk-core --test search
just test-e2e palette.spec.ts
```
