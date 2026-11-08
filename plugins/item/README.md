# plugins/item

`desk.item`, one item in Desk: a `view` plugin, data only, whose one view is inline in `plugin.json`
(`specs/view/v0`). The palette's Open in Desk shows it (`desk.views.open { id: "desk.item", params }`);
`desk.views` draws it, and nothing here runs.

| Param | What it names |
| --- | --- |
| `connector` | The item's connector, `source.connector` (`desk.fixtures`) |
| `instance` | Its instance, `source.instance` (`default`) |
| `id` | Its id within that source |

The layout is one `card` bound with no `kinds` and no `sources`: `where` matches `source.connector`,
`source.instance` and `id` to the three params (`{params.<name>}`, which desk.views fills), `limit: 1`.
It shows the title, Kind, From, Updated (relative) and the body; when the item is gone, "This item is
not in Desk any more." The card stays a card until desk.views draws `detail`.

```bash
pnpm exec vitest run plugins/item
cargo run -p desk-cli -- plugin validate plugins/item
just test-e2e e2e/palette-items.spec.ts
```
