# plugins/today

`desk.today`, the day at a glance (the requirements' DL-01): a `view` plugin, data only, whose one
view is inline in `plugin.json` (`specs/view/v0`). `desk.views` draws it; nothing here runs.

| Section | Component | Binding | Empty |
| --- | --- | --- | --- |
| Schedule | `agenda`, `range: day` | events of `$calendar` with `start lt {tomorrow}` and `end gt {today}`, earliest first | Nothing on the calendar today. |
| Due | `list` | open tasks of `$tasks` with `due lt {tomorrow}` (today's and overdue), earliest due first, 10 | Nothing due. |
| Unread | `list` | messages of `$messages` with `unread eq true`, newest first, 10 | No unread messages. |
| Last touched | `list` | notes of `$notes`, last updated first, 5 | No notes yet. |

Requires: `calendar` (events), and `tasks`, `messages` and `notes`, whose titles say "(optional)": a
require with no connected source leaves its section `unbound` with Connect a source, so the view
renders with the OS calendar alone. `{today}` and `{tomorrow}` are the engine's clock, local midnights
in the view's zone. Each binding is whole on its own, so another reader (Eris's "Three things matter
today": the first of Schedule, Due and Unread) runs it with the clock filled and the require bound.

| Contribution | What it does |
| --- | --- |
| `desk.today.open` | "Open today": an alias (`runs`) the desk answers with `desk.views.open { id: "desk.today" }` |
| `Mod+T` | Runs `desk.today.open`; turning the plugin off takes the command and the key away |

```bash
pnpm exec vitest run plugins/today
cargo run -p desk-cli -- plugin validate plugins/today
just test-e2e e2e/today.spec.ts
```
