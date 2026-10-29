# plugins/display

`desk.display`, where new surfaces go (like Emacs's `window.el` and `display-buffer-alist`). A `policy`
plugin: no code, only `contributes.display` in `plugin.json` (ADR 0017).

A rule is a `match` (plugin id with `*`, surface id, the manifest's placement; every field given must
match, an empty match matches all) and what to do: the `area` (`center`, `floating`, `left`, `right`,
`bottom`, `overlay`), a `size` (grid `columns` and `rows`, or an edge's `pixels`), `focus` (take the
keyboard focus when it opens) and `reuse` (show an open surface again instead of reopening it).

The defaults keep each manifest's placement: edges get 240, 320 and 72 px, overlays and floating
surfaces take the focus, and everything else gets one grid cell without taking the focus. A plugin's
rules are asked before these, so a plugin can say "my notes go on the right, 360 px wide":

```json
{ "match": { "plugin": "example.notes" }, "area": "right", "size": { "pixels": 360 } }
```

Commands: `desk.display.focus-next` and `focus-previous` (`Control+Tab`, `Control+Shift+Tab`, like
`other-window`), and `desk.display.show { plugin }`, which shows a plugin's surface or turns the plugin
on. The runtime side is `packages/runtime/src/display.ts` and `src/policies/display.ts`.

```bash
cargo run -p desk-cli -- plugin validate plugins/display
```
