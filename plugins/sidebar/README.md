# plugins/sidebar

The first built-in plugin: it lists the installed plugins and turns them on and off. It is a plain UI
plugin in the community folder format and uses only the public bridge API: `plugin.list`,
`plugin.setEnabled` and `plugin.changed` events, under the `plugin:manage` permission its manifest
declares (built-in plugins get their declared permissions at install).

| File | Purpose |
| --- | --- |
| `plugin.json` | id `endue.sidebar`, kind `ui`, permission `plugin:manage`, one `left` surface |
| `ui/main.js` | Renders the list; toggles call `plugin.setEnabled`; `plugin.changed` refreshes it |
| `tests/theme.test.ts` | Every colour, font, size, radius and duration comes from the `--desk-*` tokens |

Later: agents and spaces (see the design's file tree).

```bash
pnpm exec vitest run plugins/sidebar
cargo run -p desk-cli -- plugin validate plugins/sidebar
```
