---
status: accepted
date: 2026-11-04
decision-makers: Team endue
---

# Project work is read from task items through per-source adapters, and changed with task.move and task.update

## Context and Problem Statement

The projects plugin (`endue.projects`) shows work from Jira, Linear and Asana in one place, in Kanban,
Swimlane, List, Database, Timeline and Calendar views. The item kind `task` (ADR 0032, `specs/item/v0`)
keeps few fields: `status` is only open, done or cancelled, and there is no assignee, start date,
workflow status, sprint, label or estimate. Those views need all of them, and every tracker names them
differently. Where should that knowledge live, and how does a view change work it does not own?

## Decision Drivers

* Existing MCP servers stay usable as they are: Atlassian's returns Jira's REST issue, Linear's and
  Asana's their own records (ADR 0002, ADR 0032)
* The item kinds are the hardest part to change once connectors ship; ADR 0032 revisits them after five
  real connectors, not before
* Actions are commands in the one registry, with no write API (ADR 0032)
* One board across sources: the same status from two trackers is one column

## Considered Options

* Adapters in the plugin that read each source's record from `raw` into one shape of work
* New fields on the `task` kind (assignee, start, workflow status, labels, sprint, estimate) now
* A `record` kind per tracker with its own JSON Schema

## Decision Outcome

Chosen option: "adapters in the plugin", because it works with the connectors as they are and leaves the
item kinds alone until ADR 0032's review. A connector keeps its source's record whole in `raw`; an
adapter per source (`plugins/projects/ui/adapters/`) recognizes its items by the connector's id or the
record's shape and maps it, and any other task connector shows as the envelope says. Changes go through
two commands a task connector provides: `<connector>.task.move { instance, id, status }`, the status as
its source names it, and `<connector>.task.update { instance, id, due?, start?, priority?, assignee? }`.
The plugin shows a change at once and undoes it when the command fails.

### Consequences

* Good, because Jira, Linear and Asana connectors that pass their records through need nothing else,
  and Eris, agents and the palette run the same two commands the views do.
* Good, because the fields that prove common across trackers are the evidence for a later item-kind
  change.
* Bad, because the adapters depend on vendors' record shapes that have no contract here; a change in an
  API or MCP server's output needs an adapter change, which the fixtures in `plugins/projects/tests`
  catch only for the shapes they hold.
* Bad, because other views (`desk.views`) cannot read what the adapters derive until the kinds grow.
* Bad, because `task.move` and `task.update` are a naming convention, not yet a spec: a connector that
  names its commands otherwise has its controls turned off.

## More Information

ADR 0032 (items, views, connectors), ADR 0002 (MCP in the VM). `plugins/projects/README.md` describes
the commands' arguments. `specs/connector/v0` may list task actions by these names once a second
consumer needs them.
