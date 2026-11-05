---
status: accepted
date: 2026-11-04
decision-makers: Team endue
---

# Universal views draw any source of one data format, in the base system plugins share

## Context and Problem Statement

Views (ADR 0032) show the desk's items: a view binds `requires` to connector instances and its
components query the index. The owner asked for a Universal View in the base system: software that
draws views freely whatever holds the data, that plugins use, whose data may be served from anywhere
as long as it is the same supported YAML format, with timeline, calendar, kanban, list, text, chat
and agent views. Data a plugin keeps in a file, a server answers or an agent writes as it runs is not
an item in the index, and making each of them a connector is the wrong cost. Where does the universal
view live, what is its data, and how does a plugin's frame read YAML?

## Decision Drivers

* One view over any source: inline, a plugin's own file, a URL, a desk file, another plugin, the index
* Plugins use it with the SDK and the elements they already load, without code of their own per view
* Views stay data (ADR 0032): validated, shared, written by people and brains, nothing in them runs
* Every frame loads `/_desk/plugin-sdk.js` and `/_desk/ui.js`: what they carry, every frame pays for
* Spec first (AGENTS.md rule 2), and actions stay commands (ADR 0032, AX-01)

## Considered Options

* Where: the base system's shared packages (`@endue-ai/ui` draws, the SDK loads) plus a built-in
  opener; a `desk.universal` plugin only; new components in `specs/view/v0` layouts
* Data: one document (`entries` of free-form objects, a `map` from fields to roles); items only; a
  schema per presentation
* YAML in frames: the `yaml` package in the SDK; a small reader of the core schema in the SDK;
  parsing in the core over a new bridge method

## Decision Outcome

Chosen options: "the base system's shared packages plus a built-in opener", "one document" and "a
small reader in the SDK", because a plugin then gets every presentation over every source from the
files it already loads, and a source only has to answer one YAML document to be drawn.

* `specs/view/v0/universal.schema.json`: `UniversalView` (`type`, `types` to switch between,
  `source`, `map`, `options`, `actions`, `move`, `send`, `refresh`, `empty`, `provenance`) and
  `UniversalData` (`entries`, optionally `universal: v0`, `title`, `updatedAt` and its own `map`). A
  source is one of `data`, `asset`, `url` (`net.fetch`), `file` (`fs.read`), `command` (`cmd.invoke`)
  or `items` (`data.query`, live). Roles (`title`, `start`, `group`, `author`, `status`, ...) are read
  through the map; every other field travels to the actions, which are commands with templated args.
* `@endue-ai/ui` holds the DOM-free models (`rowsOf`, `timelineOf`, `calendarOf`, `kanbanOf`,
  `listOf`, `textOf`, `chatOf`, `agentOf`) and `<desk-universal-view>`, in tokens only.
* The SDK's `ctx.universal` parses, loads each source under the narrowest grant and opens a view that
  reloads and runs its commands. Its YAML reader takes YAML 1.2 under the core schema and refuses
  anchors, aliases, tags, directives, complex keys and several documents; tests hold it equal to the
  `yaml` package. The SDK grows from 30 KB to 55 KB, where the `yaml` package made it 232 KB.
* `desk.universal` (`plugins/universal`) opens a view, a file, a URL or data by command, so people,
  Eris and agents use universal views without writing a plugin.

### Consequences

* Good, because one data format reaches every presentation: a board served by a URL switches to a
  timeline or a calendar with no other change, and a plugin draws an agent's run or a chat in a line.
* Good, because sources keep the desk's permissions: a URL needs `net:fetch` for its host and a file
  `fs:read` for its path, asked when refused; an asset in the plugin's own folder needs none.
* Bad, because there are two view languages: layouts of item components (ADR 0032) and universal
  views. A later ADR may let a layout embed a universal view or redraw its components with these.
* Bad, because entries are free-form: the schema checks the document's shape, not its fields, and a
  role the data lacks is drawn empty rather than refused.
* Bad, because the YAML reader is ours to keep correct; what it refuses must stay out of the format.

## More Information

`specs/view/v0/README.md` (Universal views), `packages/ui/src/universal`,
`packages/ui/src/elements/universal.ts`, `packages/plugin-sdk/src/universal.ts`,
`packages/plugin-sdk/src/yaml.ts`, `plugins/universal`, `examples/plugin-hello-universal`. ADR 0032
(views are data), ADR 0022 (custom elements), ADR 0048 (frames fetch their own files), ADR 0004 (v0).
The design sources (`docs/ko/desk-structure.md`) gain the universal view when the owner next revises
them; `docs/architecture.md` names it beside views.
