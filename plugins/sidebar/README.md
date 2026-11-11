# plugins/sidebar

The first built-in plugin: it lists the installed plugins and turns them on and off. It is a plain UI
plugin in the community folder format and uses only the public bridge API: `plugin.list`,
`plugin.setEnabled` and `plugin.changed` events, under the `plugin:manage` permission its manifest
declares (built-in plugins get their declared permissions at install).

A plugin off for this start only says what holds it (plugin.list's `heldOff`: init.yaml's
`plugins.disabled`, safe mode, a quarantine); its box still turns it on, which ends the hold. The
desk's own key ⇧⌘X (Ctrl+Shift+X elsewhere, `desk.plugins.open`) opens the list from any desk, with the
dock and the palette off or the list itself off, and the status line says so.

| File | Purpose |
| --- | --- |
| `plugin.json` | id `endue.sidebar`, kind `ui`, permission `plugin:manage`, one `left` surface |
| `ui/main.js` | Lists the plugins; toggles call `plugin.setEnabled`; `plugin.changed` refreshes it |
| `ui/rows.js` | A row (its box, its name, why it failed or is held off) and the status line |
| `tests/rows.test.ts` | The rows: the list's own locked on, a failed one's reason, the holds, the key |
| `tests/theme.test.ts` | Every colour, font, size, radius and duration comes from the `--desk-*` tokens |

Later: agents and spaces (see the design's file tree).

```bash
pnpm exec vitest run plugins/sidebar
cargo run -p desk-cli -- plugin validate plugins/sidebar
```
