# plugins/launcher

`endue.launcher` ("Launcher"): a grid of every plugin that opens on the desk, over the whole app.
A built-in UI plugin in the community folder format, on the public SDK and bridge only. It is how a
plugin is opened on screen since the desk has no dock (ADR 0217); the palette opens plugins too.

| Does | How |
| --- | --- |
| Shows | `endue.launcher.open`: the button at the top of the account bar (bottom left), `Mod+Alt+L`, or the palette; the same command puts it away |
| Lists | Recent (what was opened from here, six at most, kept in its store), then All by name: UI plugins whose first surface is `center`, `floating` or none; not the desk's edges and overlays, not itself |
| Filters | As you type: names that start with it, then names that hold it, then ids |
| Opens | Enter on the selected tile or a press on any: `desk.plugins.open`, which turns on a plugin that is off and brings a window under others forward |
| Moves | The arrows through the grid (left and right stay the field's while it holds text) |
| Goes away | Escape, a press on the ground around the grid, or opening a plugin |

A plugin that failed to load keeps its tile, dashed, and says why it cannot open.

| Permission | Why |
| --- | --- |
| `plugin:manage` | `plugin.list`: what is installed, on or off, ready or failed |
| `cmd:invoke` (`desk.plugins.open`) | Open the plugin chosen |

| File | Purpose |
| --- | --- |
| `ui/model.js` | Which plugins get a tile, the filter, the Recent row, the arrows' steps (no DOM, tested) |
| `ui/launcher.js` | Show and hide, what is typed, the selection, opening and remembering |
| `ui/view.js`, `ui/main.js` | The field and the two grids; the SDK joined to the behaviour |

```bash
pnpm exec vitest run plugins/launcher
cargo run -p desk-cli -- plugin validate plugins/launcher
```
