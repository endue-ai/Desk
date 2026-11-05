# plugins/fleet

`desk.fleet`, the control center for agents (ADR 0100): a data-only `policy` plugin. Its one command,
`desk.fleet.open` ("Fleet: open the agents' board"), opens a universal view (ADR 0087) through
`desk.universal.open`: a kanban of every run (`kind: run` items, `specs/item/v0`) in the columns waiting,
running, done, failed and cancelled, switchable to a list and a timeline. Eris's errands, other agents'
commands, apps over MCP, the brain directory's tasks and the local agents' runs all land on it.

Each card offers the permissions plugin's commands, which hold `perm:manage`:

| Action | Command | Args from the card |
| --- | --- | --- |
| Approve | `endue.permissions.approve` | `{approval}`: the approval a waiting run waits for |
| Deny | `endue.permissions.deny` | `{approval}` |
| Stop | `endue.permissions.cancel-run` | `{id}` and `{source}`: the run and who keeps it |

The board is a universal view written as data in `plugin.json`, so a person can open it in the view
builder, change it and keep their own copy in `~/.desk/views/`. It reads items with `desk.universal`'s
own `data:read`.

```bash
pnpm exec vitest run plugins/fleet
cargo run -p desk-cli -- plugin validate plugins/fleet
```
