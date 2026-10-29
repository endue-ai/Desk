# plugins/palette

`desk.palette`, the command palette (Emacs's `M-x`) and the place where a command asks the person to
pick one of many (`completing-read`). The one default policy with code: a UI plugin on a `hidden`
overlay that shows itself when asked. It uses only the public SDK over the core's command registry:
`ctx.commands.list` (`cmd.list`), `run` (`cmd.invoke`, under the `cmd:invoke` grant for every id its
manifest asks for) and `on`; the keys it shows come from `desk.keys.list`.

| Command | What it does |
| --- | --- |
| `desk.palette.open` | Lists every command the desk has now with its keys; typing filters, Enter runs |
| `desk.palette.pick` | `{ title, items: [{ id, label, detail }], free }`: answers the picked id (with `free`, also what was typed), or fails `cancelled` |
| `desk.palette.cancel` | Closes it; a pick in progress fails `cancelled` (Escape, `desk.keys.quit`) |

Run history (most recent first, `desk.palette.history` long from `init.get`, 50 by default) is kept with
`store.set`, so
it survives restarts and ranks commands while nothing is typed. Matching is in `ui/match.js`, without a
DOM, so `tests/match.test.ts` runs in vitest.

| File | Purpose |
| --- | --- |
| `ui/main.js` | The overlay: listing, keys (arrows, Enter, Escape), history, pick and cancel |
| `ui/match.js` | Subsequence scoring over titles, ids and keywords; history ranking |

```bash
pnpm exec vitest run plugins/palette
cargo run -p desk-cli -- plugin validate plugins/palette
```
