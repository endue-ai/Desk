# plugins/universal

`desk.universal`, Universal View (ADR 0084): opens one universal view (`specs/view/v0/universal.schema.json`)
on a hidden overlay, with the public SDK only, as a community plugin would. `ctx.universal.open` loads
its source and draws it with `<desk-universal-view>`; the desk, Eris, agents and the palette open one
by command instead of writing a plugin.

| Command | What it does |
| --- | --- |
| `desk.universal.open` | `{ view }` as given, `{ file }` (a YAML file holding a view, or data), `{ url }` (http, https) or `{ data }`; `type` shows another presentation first, `title` names it. Data without a view opens as a list that switches to every presentation |
| `desk.universal.close` | Ends its reloads and subscription and hides it (Escape) |
| `desk.universal.allow` | Asks for the permission the source was refused (the notice's Allow button), then loads it again |

| Permission | Why |
| --- | --- |
| `data:read` | An `items` source |
| `fs:read` (`${home}/**`) | A `file` source, and the view files `desk.universal.open { file }` reads |
| `cmd:invoke` (`*`) | A `command` source, and the view's actions, `move` and `send` |

A `url` source asks for `net:fetch` on its host when it opens (the notice), so no host is granted
ahead of time.

| File | Purpose |
| --- | --- |
| `ui/open.js` | The arguments as the view they open; the permission a source is read under |
| `ui/screen.js` | The page: the view, and the notice that asks for a refused source |
| `ui/main.js` | The commands and Escape |

`pnpm exec vitest run plugins/universal`; `cargo run -p desk-cli -- plugin validate plugins/universal`.
