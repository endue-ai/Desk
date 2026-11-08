# Desk view v0

A view is a surface that shows items, written as data instead of code (ADR 0032). Like a policy plugin
(ADR 0017) it is validated at install and shared without review. A person's views are YAML files,
`~/.desk/views/<id>.yaml`; a plugin of kind `view` carries one inline (`view`) or as files in its folder
(`views`); on the wire a view is JSON of the same shape. v0 may break on any minor release (ADR 0004).

Universal views (below) are the view language (ADR 0103). The item view, `View` in
`view.schema.json`, is deprecated: the desk reads item views through v0 and writes none.

| Field | Meaning |
| --- | --- |
| `id`, `version` | Lowercase and dotted like a plugin id (`desk.today`); a semantic version |
| `title`, `description` | A template; one sentence |
| `requires` | The sources it needs, by name: `{ kinds, connector?, title? }`. The person picks an instance for each when it opens, so one view opens on two accounts |
| `params` | Values set when it opens: `string`, `integer` (`minimum`, `maximum`), `boolean` or `enum` (`choices`); without a `default` the person is asked |
| `layout` | A tree of containers and components |
| `provenance` | Who made it (`person`, `eris`, an agent, a plugin), when, from which words, with which brain |

Containers arrange their `children`: `grid` (`columns`), `split` and `stack` (`direction`), and `tabs`
(each child's `title` is its tab). Components show items: `list`, `table`, `card`, `detail` (the
selected item, else the binding's first), `calendar` and `agenda` (`range`: `day`, `week`, `month`),
`kanban` (a column per `groupBy` value), `chart` (`bar`, `line`, `sparkline`: a metric's points, or
counts per `groupBy` value), `markdown` (`text`) and `stat` (how many items, or `text` for the first).
Each has an optional `title`, `binding`, `fields` (`{ label?, value }`), `actions` and `empty` text.

- A `binding` is an `ItemQuery` (`specs/item/v0`). Its `sources` name `requires` entries as `$name`,
  which the view engine resolves to the picked instances when the view opens.
- Every action is a command: `{ command, title?, args?, key? }`. Keys, the palette, Eris and agents run
  the same id. A view runs no code; what it cannot say is a UI plugin's job.
- A template is text in which `{path}` is a field of the item in scope and `{params.<name>}` a param;
  `{path|time}`, `|date`, `|relative` and `|number` format it, and `{{` `}}` are braces. Titles, field
  values, `text` and the strings in action `args` and binding `where` values are templates, so
  `{params.<name>}` is filled in a `where` value and an action arg too. There is no expression
  language in v0.
- `{now}`, `{today}`, `{tomorrow}` and `{yesterday}` are the view engine's clock, in the view's time
  zone, as RFC 3339 instants: now, and the starts of this day, the next and the one before. A `where`
  value `{today}` compares as an instant (`start gte {today}`, `due lt {tomorrow}`). A template that is
  one placeholder alone keeps the value's type (a number stays a number).

Two rules go beyond the schema: every `$name` is a `requires` entry and every `{params.<name>}` a
declared param. `desk_bridge::view_problems` checks them; the contract tests judge the vectors with it.

## Universal views

`universal.schema.json` is the universal view (ADR 0087): one presentation of entries from any source
that serves the universal data format, so the same view works whatever holds the data. `@endue-ai/ui`
draws it (`<desk-universal-view>`), `ctx.universal` in the plugin SDK loads its source, and the built-in
`desk.universal` opens one by command.

| `UniversalView` | Meaning |
| --- | --- |
| `type`, `types` | `timeline`, `calendar`, `kanban`, `list`, `text`, `chat`, `agent`, `chart`, `stat` or `detail`; `types` are the ones the person may switch between |
| `params` | Values given when it opens, as an item view's: read as `{params.<name>}` in an items query |
| `source` | One of `data` (inline), `asset` (a file in the plugin's folder), `url` (http/https, `net.fetch`), `file` (`fs.read`), `command` (`cmd.invoke`: another plugin serves it) or `items` (an `ItemQuery` on the desk's index, live) |
| `map` | Which entry field plays which role (`start: due`, `group: column`); a role left out reads its own name |
| `options` | `groups` (kanban columns), `range` (calendar), `order`, `zone`, `me` (chat), `placeholder`, `chart` (`bar`, `line`, `sparkline`), `aggregate` (stat: `count`, `sum`, `latest`) |
| `actions`, `move`, `send` | Commands, as in a view: on an entry (`{id}`), on a kanban move (`{move.from}`, `{move.to}`), on sent text (`{send.text}`) |
| `refresh`, `empty`, `provenance` | Load the source again every so many seconds (5 at least); the empty text; who made it |

`UniversalData` is the format every source but `items` answers, as YAML or JSON: `entries` (free-form
objects, 10 000 at most) and optionally `universal: v0`, `title`, `description`, `updatedAt` and a `map`
of its own, which a view's `map` overrides. A YAML document that is a bare list is its entries. The roles
are `id`, `title`, `text` (Markdown), `detail`, `start` and `end` (RFC 3339 with an offset, or a
`YYYY-MM-DD` day), `group`, `author`, `role`, `status` (`pending`, `running`, `done`, `failed`,
`waiting` or any word), `tags`, `url` and `value` (a number, for a chart or a stat); every other
field travels with the entry to its actions. Items become entries with their kind's fields in their
roles: an event's `start`, `end` and `allDay`, a task's `due` as its `start` and `status` as its
`group`, a message's sender as its `author`.

An `items` source's `where` values read the clock and the params, filled when it loads: `{now}`,
`{today}`, `{tomorrow}` and `{yesterday}` as in item views, and `{params.<name>}`. Its `sources` name
connectors (`desk.github`) or instances; a universal view has no `requires`, so without `sources` it
reads every source of its kinds.

A `UniversalPage` lays several universal views out together (Today, a digest): `title`, `description`,
`params` (reaching every section), `columns` (1 to 4) and `sections`, each a universal view without an
`id`, `params` or `provenance` of its own. A view plugin's `view` and `views` hold a universal view or
page with its `id` (`PluginView` in `specs/plugin/v0`), or a deprecated item view.

A person keeps universal views in `~/.desk/views/<id>.yaml` beside item views, through the same `view.*`
methods (ADR 0102): one saved there needs its `id`. Eris makes one from a sentence (`desk.propose`), and
`desk.universal.build` makes the same file by hand.

`vectors/` holds valid and invalid views for the contract tests.
