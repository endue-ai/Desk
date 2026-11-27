# examples/plugin-hello-window

The smallest app that says how its window opens (ADR 0226). Its manifest's `window` block asks for a
page of 480 × 360 px the first time, never smaller than 320 × 240, in an OS window of its own. The
same page runs on the canvas: nothing in its code tells the two apart.

## Run it

```bash
just example plugin-hello-window                        # out of the canvas, as its manifest says
DESK_APP_WINDOWS=off just example plugin-hello-window   # on the canvas
```

Out, Window > Move to endue docks it; on the canvas, the palette's "Pop out window" moves it out. Either
move loads the page again and the count stays, because it lives in plugin state.

## Files

| File | Purpose |
| --- | --- |
| `plugin.json` | The manifest (specs/plugin v0): one surface with `window.size`, `minSize` and `opens` |
| `ui/index.html` | The entry page; its import map points `@endue-ai/plugin-sdk` at `/_desk/plugin-sdk.js` |
| `ui/main.js` | `defineUiPlugin(plugin)`: connects the plugin to the desk |
| `ui/plugin.js` | The plugin's `mount`: its page's size, a counter in state, a bridge call |
| `ui/style.css` | The plugin's own styles |
| `tests/plugin.test.js` | Its test on the SDK's test host, in a jsdom page |

## Check it

```bash
cargo run -p desk-cli -- plugin validate examples/plugin-hello-window
cargo run -p desk-cli -- plugin test examples/plugin-hello-window
just build-shell   # then, the same page in both windows of the real desk:
just test-app-e2e --spec e2e/specs/app-opens-out.spec.ts --spec e2e/specs/app-opens-canvas.spec.ts
```

See `docs/plugins/authoring.md`, "How an app's window opens".
