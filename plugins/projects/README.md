# plugins/projects

`endue.projects`, project management over every task source, in the community folder format and on the
public SDK only. One `center` surface shows the `task` items of the desk's index (ADR 0032) as one set
of work in six views: Kanban (a column per status), Swimlane (those columns in lanes by a field), List
(grouped rows), Database (a table of chosen fields, sorted by its headings), Timeline (bars from start
to due, milestones, today) and Calendar (work on its due date). Its page takes every colour, font,
size and radius from the theme (`tests/theme.test.ts`).

Adapters (`ui/adapters/`, ADR 0085) read each source's own record, which its connector keeps whole in
`raw`, into one shape (status and its category, type, priority, assignee, labels, project, sprint,
parent, start, due, estimate, link): Jira issues as its REST API and the Atlassian MCP server return
them, Linear issues from its GraphQL API or its MCP server, Asana tasks from its REST API or its MCP
server. A source is known by its connector's id or its record's shape; any other task connector shows
as the item's envelope says. "To Do" from Jira and "Todo" from Linear are one column.

The plugin reads but never writes the index: changes go through the task connector's commands. A
connector `acme.jira` provides `acme.jira.task.move { instance, id, status }` (the status as its source
names it) and `acme.jira.task.update { instance, id, due?, start?, priority?, assignee? }` (dates as
YYYY-MM-DD or null, priority 1 to 4 or null, assignee `{ name?, email? }` or null). Dragging a card to
a column, a lane (priority or assignee) or a calendar day, Shift+arrows and the details run them, shown
at once and undone when refused; controls for actions a connector lacks are off.

Keyboard: `j` `k` or arrows walk the work, Enter opens it, Escape closes it, Shift+arrows move it a
column, `1` to `6` switch views, `/` searches, `[` `]` `t` step the period, `o` opens the original.

| Permission | Why |
| --- | --- |
| `data:read` (`task`) | List and follow tasks in the index, up to 2000; asked once on a refusal |
| `cmd:invoke` (`*.task.move`, `*.task.update`, `desk.palette.pick`, `desk.connectors.open`) | Act through the connectors; ask for words; lead to connecting a source |
| `shell:open` (`https`) | Open the original issue in the browser |

Settings: `endue.projects.view`, `.week-start`, `.show-done`, `.columns`. The store keeps the view,
grouping, sort, source, done filter, zoom and columns (`view`), never the work.

```bash
pnpm exec vitest run plugins/projects
cargo run -p desk-cli -- plugin validate plugins/projects
```
