# examples/plugin-hello-universal

The smallest universal view (ADR 0087): a board kept as YAML in `data/board.yaml`, drawn by
`ctx.universal.open` as a kanban that switches to a list, a timeline and a calendar. Its data is the
universal data format, so the same view works when `source` is a URL, a desk file, another plugin's
command or the desk's items instead of this folder's file.

## Run it

```bash
DESK_DEV_PLUGINS=$PWD/examples/plugin-hello-universal just dev
```

Edit `data/board.yaml` (move a card to another `column`) and the view loads it again within a minute;
drag a card or press Shift and an arrow to move it on screen.

## Files

| File | Purpose |
| --- | --- |
| `plugin.json` | The manifest: kind `ui`, one surface; an asset needs no permission |
| `data/board.yaml` | Universal data: `entries` and a `map` from its own fields to the roles |
| `ui/plugin.js` | The view as data (`type`, `types`, `source`, `options`) and `universal.open` |
| `ui/main.js`, `ui/index.html` | The entry: loads `@endue-ai/ui` for `<desk-universal-view>` and the SDK |
| `tests/plugin.test.js` | Its test on the SDK's test host, in a jsdom page |

## Check it

```bash
cargo run -p desk-cli -- plugin validate examples/plugin-hello-universal
cargo run -p desk-cli -- plugin test examples/plugin-hello-universal
```
