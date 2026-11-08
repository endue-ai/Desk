# plugins/today

`desk.today`, the day at a glance (the requirements' DL-01): a `view` plugin, data only, whose one
view is a page of universal views inline in `plugin.json` (`UniversalPage`, `specs/view/v0`, ADR
0103). `desk.views.open` hands it to `desk.universal`, which draws it; nothing here runs.

| Section | Presentation | Items query | Empty |
| --- | --- | --- | --- |
| Schedule | `calendar`, `range: day` | events with `start lt {tomorrow}` and `end gt {today}`, earliest first | Nothing on the calendar today. |
| Due | `list` | open tasks with `due lt {tomorrow}` (today's and overdue), earliest due first, 10 | Nothing due. |
| Unread | `list` | messages with `unread eq true`, newest first, 10 | No unread messages. |
| Last touched | `list` | notes, last updated first, 5 | No notes yet. |
| GitHub | `list` | open tasks of `desk.github` (ADR 0106), last updated first, 10 | No open GitHub work. |

Two columns. Each query reads every source of its kinds the desk lets `desk.universal` read, so the
page renders with the OS calendar alone and nobody picks a source; a kind nothing serves draws its
empty text. `{today}` and `{tomorrow}` are the starts of this day and the next in the view's zone,
filled when a section loads. Each query is whole on its own, so another reader runs it with the
clock filled.

| Contribution | What it does |
| --- | --- |
| `desk.today.open` | "Open today": an alias (`runs`) the desk answers with `desk.views.open { id: "desk.today" }` |
| `Mod+T` | Runs `desk.today.open`; turning the plugin off takes the command and the key away |

```bash
pnpm exec vitest run plugins/today
cargo run -p desk-cli -- plugin validate plugins/today
just test-e2e e2e/today.spec.ts
```
