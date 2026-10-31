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
| `desk.palette.items` | Its palette provider: a `PaletteQuery` answered from `data.query` with `text` (`data:read`) |

Providers (`contributes.paletteProviders`, `specs/plugin/v0`): on open it reads them from
`desk.palette.providers`, and each change of a trimmed query of two characters or more asks them all
at once with `{ query, limit: 5 }`. Each answer for the query still typed becomes a group after the
commands, in the providers' order; a failed or malformed answer has none. An item opens in Desk
(`desk.item`) or, with a `deepLink`, in its app. The arrows move through commands and results as one
list; Enter runs a command or a result's first action, Mod+Enter its second. Results stay out of the
history.

Run history (most recent first, `desk.palette.history` long from `init.get`, 50 by default) is kept
with `store.set`, so it survives restarts and ranks commands while nothing is typed.

| File | Purpose |
| --- | --- |
| `ui/main.js` | The overlay: listing, groups, keys (arrows, Enter, Mod+Enter, Escape), history, pick, cancel |
| `ui/match.js` | Subsequence scoring over titles, ids and keywords; history ranking |
| `ui/providers.js` | Asking providers, stale and malformed answers, item results, rows (no DOM) |

```bash
pnpm exec vitest run plugins/palette
cargo run -p desk-cli -- plugin validate plugins/palette
```
