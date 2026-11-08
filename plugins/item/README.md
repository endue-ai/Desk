# plugins/item

`desk.item`, one item in Desk: a `view` plugin, data only, whose one view is a universal `detail`
view inline in `plugin.json` (`specs/view/v0`, ADR 0103). The palette's Open in Desk shows it
(`desk.views.open { id: "desk.item", params }`); `desk.universal` draws it, and nothing here runs.

| Param | What it names |
| --- | --- |
| `connector` | The item's connector, `source.connector` (`desk.fixtures`) |
| `instance` | Its instance, `source.instance` (`default`) |
| `id` | Its id within that source |

Its source is an items query with no `kinds` and no `sources`: `where` matches `source.connector`,
`source.instance` and `id` to the three params (`{params.<name>}`, filled when it loads), `limit: 1`.
The detail shows the item's fields as label and value rows, its roles first (title, text, when);
when the item is gone, "This item is not in Desk any more."

```bash
pnpm exec vitest run plugins/item
cargo run -p desk-cli -- plugin validate plugins/item
just test-e2e e2e/palette-items.spec.ts
```
