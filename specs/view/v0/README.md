# Desk view v0

A view is a surface that shows items, written as data instead of code (ADR 0032). Like a policy plugin
(ADR 0017) it is validated at install and shared without review. A person's views are YAML files,
`~/.desk/views/<id>.yaml`; a plugin of kind `view` carries one inline (`view`) or as files in its folder
(`views`); on the wire a view is JSON of the same shape, `View` in `view.schema.json`. v0 may break on
any minor release (ADR 0004).

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

`vectors/` holds valid and invalid views for the contract tests.
