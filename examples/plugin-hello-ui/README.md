# examples/plugin-hello-ui

The smallest UI plugin: a sandboxed page, one bridge call (`perm.query`) and a counter kept in plugin
state, so it survives hot reloads.

## Run it

```bash
just dev
```

`just dev` installs this folder as a dev plugin. It appears on the desk; edit `ui/plugin.js` or
`ui/index.html` and save: only this surface reloads, within a second, and the count stays.

## Files

| File | Purpose |
| --- | --- |
| `plugin.json` | The manifest (specs/plugin v0): id, version, kind `ui`, entry, one surface |
| `ui/index.html` | The entry page; its import map points `@endue-ai/plugin-sdk` at `/_desk/plugin-sdk.js` |
| `ui/main.js` | `defineUiPlugin(plugin)`: connects the plugin to the desk |
| `ui/plugin.js` | The plugin's `mount`: state, a button, a bridge call; no SDK import, so tests run it |
| `ui/style.css` | The plugin's own styles (plugins do not share the desk's CSS) |
| `tests/plugin.test.js` | Its test on the SDK's test host, in a jsdom page |

## Check it

```bash
cargo run -p desk-cli -- plugin validate examples/plugin-hello-ui
cargo run -p desk-cli -- plugin test examples/plugin-hello-ui
```

Copy this folder to start a plugin; change the `id` first. See `docs/plugins/authoring.md`.
