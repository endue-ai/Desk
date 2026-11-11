# plugins/dock

The bottom dock: one tile per plugin that opens on the desk (first surface `center`, `floating` or
none). A tile opens its plugin with `plugin.setEnabled` and puts it away again; the core remembers the
choice. The desk's own chrome (edge and overlay plugins) gets no tile. A failed plugin keeps its tile,
dashed and unavailable, with the reason. It uses only the public bridge API (`plugin.list`,
`plugin.setEnabled`, `plugin.changed`) under the `plugin:manage` permission its manifest declares.

The row is centred while it fits. When it does not, it starts at its first tile and scrolls: a wheel
(vertical or sideways), the scroll bar, or the keys (arrows, Home, End), which bring the tile they
move to wholly into sight.

| File | Purpose |
| --- | --- |
| `plugin.json` | id `endue.dock`, kind `ui`, permission `plugin:manage`, one `bottom` surface |
| `ui/tiles.js` | Which plugins get a tile, their name, initial and state (no DOM, tested) |
| `ui/scroll.js` | How far a wheel and a newly focused tile scroll the row (tested) |
| `ui/main.js` | Renders the tiles; arrow keys, Home and End move between them (roving tabindex) |
| `tests/` | `tiles`, `scroll`, `theme` (only `--desk-*` tokens) (vitest); the dock on a desk: `packages/runtime/e2e/dock.spec.ts` (edges page, 24 tiles at 1280 px) |

Later, when the bridge has layout and surface APIs: saved layouts as cards (first run, scene 9),
put-away surfaces instead of turning plugins off, and running work.

```bash
pnpm exec vitest run plugins/dock/
cargo run -p desk-cli -- plugin validate plugins/dock
```
