# examples/plugin-hello-view

The smallest view plugin: a view as data in `plugin.json` (`specs/view/v0`, ADR 0032), no code.
It lists the notes touched last, newest first, from whichever connected source the person picks
for its `notes` requirement, and offers `example.hello-view.open`, an alias of `desk.views.open`.
`pnpm create @endue-ai/plugin --kind view` writes the same folder.

## Run it

```bash
just dev
```

`just dev` loads this folder as a dev plugin. Open it from the palette (Open Hello view) or with
`desk cmd run example.hello-view.open`; save `plugin.json` and the view follows.

## Files

| File | Purpose |
| --- | --- |
| `plugin.json` | The manifest (specs/plugin v0): kind `view`, the view inline, one command |
| `tests/view.test.js` | Its test on the SDK's test host: `view.save` checks the view as the desk does, and its list's query runs on items the test puts in the index |

## Check and test it

```bash
cargo run -p desk-cli -- plugin validate examples/plugin-hello-view
cargo run -p desk-cli -- plugin test examples/plugin-hello-view
```
