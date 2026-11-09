# plugins/inspector

`desk.inspector`: what the desk holds now, read-only, for builders. A built-in UI plugin in the
community folder format, on the public bridge only. It autoloads: off until the person opens it (the
palette, "Inspect the desk", `desk plugin enable desk.inspector`), so no window opens at every start.

| Section | From |
| --- | --- |
| Render tree | `desk.inspect.open` `tree`: ADR 0011's serialized tree of `#desk`, the e2e snapshots' |
| Surfaces and buffers | `desk.inspect.open` `surfaces`: surfaces with their plugin, placement and whether asleep, views, buffers, live frames (ADR 0134) |
| Commands | `cmd.recent`: the last 200 invocations with caller, provider, milliseconds, outcome |
| Grants | `perm.list`, by caller |
| Settings | `desk.inspect.open` `settings`: each value with the layer that won and the values skipped |
| Plugins | `plugin.list`: on or off, autoload, and quarantined or not responding when it says so |
| Bridge calls | `plugin.stats`: calls and failures per caller over the last minute |

The section in view refreshes every 2 s, the runtime's every 5 s (each read is an invocation). The
filter keeps rows with a cell that contains it. Export JSON shows the section as
`{ "<section>": data }`, keys sorted, two spaces: what `desk inspect <section>` prints.

| Permission | Why |
| --- | --- |
| `perm:manage` | `cmd.recent`, `plugin.stats`, `perm.list`; `desk.inspect.open` answers only holders |
| `plugin:manage` | `plugin.list`, and `plugin.changed` to refresh |
| `cmd:invoke` (`desk.inspect.open`) | The runtime's sections |

| File | Purpose |
| --- | --- |
| `ui/sections.js` | The sections, their sources, plugin states and the export text |
| `ui/model.js` | Each section as tables of text, and the filter |
| `ui/controller.js` | Reads, refreshes, filters and exports the section in view |
| `ui/view.js` | Tablist, filter, tables, the export dialog and their keys |
| `ui/main.js` | Mounts the plugin and joins the view to the controller |

`tests/golden/`: what the core and the runtime answer, and what Export JSON and `desk inspect` print.

```bash
pnpm exec vitest run plugins/inspector
cargo run -p desk-cli -- plugin validate plugins/inspector
```
