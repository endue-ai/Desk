# examples/plugin-hello-ui

The smallest UI plugin: a sandboxed page, one bridge call (`perm.query`) and a counter kept in plugin
state, so it survives hot reloads.

## Run it

```bash
just dev
```

`just dev` installs this folder as a dev plugin. It appears on the desk; edit `ui/main.js` or
`ui/index.html` and save: only this surface reloads, within a second, and the count stays.

## Files

| File | Purpose |
| --- | --- |
| `plugin.json` | The manifest (specs/plugin v0): id, version, kind `ui`, entry, one surface |
| `ui/index.html` | The entry page; its import map points `@endue-ai/plugin-sdk` at `/_desk/plugin-sdk.js` |
| `ui/main.js` | `defineUiPlugin({ mount })`: state, a button, a bridge call |
| `ui/style.css` | The plugin's own styles (plugins do not share the desk's CSS) |

## Check it

```bash
cargo run -p desk-cli -- plugin validate examples/plugin-hello-ui
```

Copy this folder to start a plugin; change the `id` first. See `docs/plugins/authoring.md`.
