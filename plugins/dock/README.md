# plugins/dock

The bottom dock: one tile per plugin that opens on the desk (first surface `center`, `floating` or
none). A tile opens its plugin with `plugin.setEnabled` and puts it away again; the core remembers the
choice. The desk's own chrome (edge and overlay plugins) gets no tile. A failed plugin keeps its tile,
dashed and unavailable, with the reason. It uses only the public bridge API (`plugin.list`,
`plugin.setEnabled`, `plugin.changed`) under the `plugin:manage` permission its manifest declares.

| File | Purpose |
| --- | --- |
| `plugin.json` | id `endue.dock`, kind `ui`, permission `plugin:manage`, one `bottom` surface |
| `ui/tiles.js` | Which plugins get a tile, their name, initial and state (no DOM, tested) |
| `ui/main.js` | Renders the tiles; arrow keys, Home and End move between them (roving tabindex) |
| `tests/` | `tiles.test.ts` (vitest); the dock on a desk: `packages/runtime/e2e/dock.spec.ts` |

Later, when the bridge has layout and surface APIs: saved layouts as cards (first run, scene 9),
put-away surfaces instead of turning plugins off, and running work.

```bash
pnpm exec vitest run plugins/dock
cargo run -p desk-cli -- plugin validate plugins/dock
```
