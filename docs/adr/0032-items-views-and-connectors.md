---
status: accepted
date: 2026-10-31
decision-makers: Team endue
---

# Connected data is items of one model, views are data, connectors have one contract, actions are commands

## Context and Problem Statement

Desk's integration layer takes in what the apps a person already uses hold (calendars, mail, tasks,
files, feeds), shows it on surfaces the person makes by talking or gets from the market, and acts on it
from there: connectors bring data in, items are its one shape, views show them, actions go back out.
The maintainer's integration requirements draft is not in the repository yet, so this record carries its
four decisions in full. Each is hard to reverse once connectors, views and the index exist: how many
shapes connected data has (DM-01), whether a view is code or data (VW-01, VW-02), what a connector is
(CN-01), and how anyone changes data in an app (AX-01, CN-05). Issue #92 writes the specs (BR-11); the
bridge methods that reach them follow in #103.

## Decision Drivers

* One view shows data from any source: a list, a calendar, a board or a chart over the same items
* Views are made by talking, checked at install and shared without code review, like policies (ADR 0017)
* Existing MCP servers work as they are (ADR 0002); local connectors (the OS calendar, a folder) run
  without booting the VM
* Seeing and doing take one path: keys, the palette, Eris and agents run the same commands
* Everything that crosses a boundary is in `specs/` first, with vectors and codegen (AGENTS.md rule 2)

## Considered Options

* Items: eight kinds plus `record`; a free-form record per connector; a large model with every app's fields
* Views: data (a plugin kind `view`); code only (UI plugins); data with an embedded script language
* Connectors: one logical contract with two bindings (Wasm, MCP); MCP only; Wasm only; one contract per
  app category
* Actions: commands in the one registry (ADR 0017); a write API per connector behind `data:write`

## Decision Outcome

Chosen options: "eight kinds plus `record`", "views are data", "one contract with two bindings" and
"actions are commands", because together they give one index, one view language and one registry that
every source, every surface and every caller share.

**One item model (DM-01).** `specs/item/v0` is an envelope every kind shares: `id` (unique within its
source; an index keys items by connector, instance and id, and there is no global id format), `source`
(`connector`, `instance`), `kind`, `title`, `updatedAt`, and optionally `createdAt`, `deepLink` (the way
back to the original app), `body` and `raw` (everything else the source said). The kinds are `event`,
`message`, `task`, `note`, `file`, `person`, `entry` (a feed entry) and `metric` (a time series), each with
few fields of its own, plus `record`, whose `fields` follow the JSON Schema it names. Times are RFC 3339
with an offset; an RRULE is kept as written. `ItemQuery` narrows by kinds, sources, full-text `text` and
`where` conditions that must all hold (`eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `contains`, `exists` on
dotted paths), sorts, and pages with an opaque cursor, 50 items by default and 500 at most; `ItemChange`
is an upsert or a removal. Fewer kinds and views could not use the data; more and connectors could not
fill them. The count is revisited after five real connectors; until then a vendor's own kind is a record.

**Views are data (VW-01, VW-02).** A view is a file, not code: `View` in `specs/view/v0`, YAML in
`~/.desk/views/`, or a plugin of kind `view` with no entry that carries one inline (`view`) or as files
(`views`). It declares `requires` (named sources: kinds and optionally a connector, bound to instances
when it opens, so one view opens on two accounts), `params` (string, integer, boolean, enum), a layout
tree of containers (`grid`, `split`, `tabs`, `stack`) and components (`list`, `table`, `card`, `detail`,
`calendar`, `agenda`, `kanban`, `chart`, `markdown`, `stat`) with bindings (`ItemQuery`, naming requires
as `$name`), fields, actions and empty text, and `provenance` (who made it, when, from which words).
Templates (`{path}`, `{params.name}`, `|time`, `|date`, `|relative`, `|number`) are the only computation;
the expression language (VW-03) comes later. The schema checks a view at install, plus two rules it
cannot say: every `$name` is a requires entry and every param a template reads is declared
(`desk_bridge::view_problems`). What a view cannot say is a UI plugin's job.

**One connector contract, two bindings (CN-01).** A plugin of kind `connector` declares `connector`:
`binding` `wasm` (a component its entry names; no VM) or `mcp` (a server in the VM), `auth` (`none`,
`token`, `oauth`: declared, with no flow in v0), `resources` (per item kind: its actions and whether it
answers live queries), `sync` (`pull`, `push`, `both`; an interval) and `instanceSettings`, whose `secret`
fields the core keeps and never lists or hands to the connector's code. The host sees `ConnectorInstance`,
`ConnectorStatus` (`connected`, `syncing`, `stale`, `error`, `paused`) and `ConnectorSyncResult`. Any MCP
server is a weak connector (tools for the brain); one that follows the Desk profile in
`specs/connector/v0/README.md` (item resources as `application/vnd.endue.item+json`, `desk://sync`) is a
strong one whose items views show.

**Actions are commands (AX-01, CN-05).** A connector's actions are commands it declares in
`contributes.commands` and lists per resource; a view's actions name command ids with templated args;
keys, the palette, Eris and agents run them all with `cmd.invoke` under `cmd:invoke`. There is no
`data:write`. Reading the index is `data:read` (`kinds`, and `sources` as connector id patterns matched
like command ids; absent means all); managing connections is `connector:manage` and the person's views
`view:manage`, scopeless like `plugin:manage`. The draft's `connector:read` and `connector:act` per
instance and kind become `data:read` and `cmd:invoke`; a per-instance `sources` form can narrow them later.

### Consequences

* Good, because one index, one search and one permission filter cover every source, and a view written
  for one calendar works on any.
* Good, because views are files that people and brains write, the schema checks at install and the market
  shares without review: nothing in a view runs.
* Good, because existing MCP servers become connectors unchanged, and light connectors skip the VM.
* Good, because every action is in one registry, so undo, approval, the palette and agents see them alike,
  and there is no write API to secure.
* Bad, because kinds keep few fields: what else a view needs is in `raw`, which has no contract, so a view
  that reads `raw.labels` depends on one connector.
* Bad, because a view cannot compute until the expression language exists.
* Bad, because two bindings must stay equal: the Wasm one still needs its WIT world (`desk:connector`) and
  both need conformance vectors.
* Bad, because the schemas check shapes, not names: `$name`s, params and connector actions need their own
  check in every validator (Rust and the TypeScript contract test today).
* Bad, because v0 may break on any minor release (ADR 0004), yet the item kinds are the hardest part to
  change once connectors ship.

## More Information

Issue #92 (the specs, codegen, `desk plugin validate`, vectors) and #103 (`data.*`, `connector.*`,
`view.*`, `catalog.get`, the stub's fixtures). Specs: `specs/item/v0`, `specs/view/v0`,
`specs/connector/v0`, `specs/plugin/v0`. Requirements DM-01, VW-01, VW-02, VW-03, CN-01, CN-05, AX-01 and
BR-11 of the integration requirements draft, and BR-05, BR-06 of `docs/ko/desk-requirements.md`.
ADR 0002 (MCP in the VM), ADR 0004 (v0 compatibility), ADR 0017 (contributions are data). The layer
gets its place in `docs/ko/desk-structure.md` and `docs/architecture.md` when the draft lands.
