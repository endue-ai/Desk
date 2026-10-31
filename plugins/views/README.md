# plugins/views

`desk.views`, the view engine (ADR 0032): it turns a view file (`specs/view/v0`) into a surface, on the
public SDK only. A UI plugin on one hidden overlay, like `desk.palette`. It reads views only over the
bridge (`view.get` under `view:manage`), binds each `requires` entry to an instance from
`connector.list` (the one candidate, the `bindings` it was given, or `desk.palette.pick`), runs every
binding through `data.query` and keeps it live with `data.subscribe`, and draws with `@endue-ai/ui`.

| Command | What it does |
| --- | --- |
| `desk.views.open` | `{ id, params?, bindings? }`: opens a view, replacing the one shown; bindings are `{ name: "connector/instance" }` |
| `desk.views.close` | Ends its subscriptions and hides it (Escape) |
| `desk.views.reconnect` | `{ connector, instance }`: `connector.sync` (the Reconnect button) |
| `desk.views.request-access` | `{ kinds, sources }`: `perm.request` for that `data:read`, then queries again |
| `desk.views.open-original` | `{ url }`: fails `failed` until `shell.open` is served; its menu item says so in a toast |

Components: `list`, `table` (sortable columns), `agenda` (its day, a now-line), `stat`, `markdown` and
`card`, in `grid`, `split`, `stack` and `tabs`. `calendar`, `kanban`, `chart` and `detail` say they come
later. Each draws its state in `data-state`, never a blank: `loading`, `ready`, `empty`, `stale` and
`error` (with Reconnect), `denied` (Ask for access), `unbound` (Connect a source), `placeholder`. Enter
runs an item's first action; `.` and a right click open its actions. Under 480 px it draws compact.

| Permission | Why |
| --- | --- |
| `data:read` | Read the items its views bind |
| `connector:manage` | List instances to bind requires, follow their status, sync on Reconnect |
| `view:manage` | Read the views it opens and follow changes to them |
| `cmd:invoke` (`*`) | Run the actions views name, `desk.palette.pick` and its own commands |

| File | Purpose |
| --- | --- |
| `ui/engine.js` | The controller: open, bind, query, subscribe, events and commands |
| `ui/components.js`, `ui/present.js` | Layout models and component states; what each element shows |
| `ui/template.js`, `ui/resolve.js` | Templates and the clock; requires against instances |
| `ui/draw.js`, `ui/render.js`, `ui/main.js` | The DOM: containers, components, keys, menu, density |

```bash
pnpm exec vitest run plugins/views
cargo run -p desk-cli -- plugin validate plugins/views
```
