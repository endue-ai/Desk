# Desk item v0

An item is the one shape connectors bring data in as, the core's index keeps and views show (ADR 0032).
`item.schema.json` is the item: an envelope every kind shares plus the fields of its kind.
`query.schema.json` carries items: `ItemQuery`, `ItemPage` and `ItemChange`. v0 may break on any minor
release (ADR 0004).

| Envelope | Meaning |
| --- | --- |
| `id` | Unique within its source, as the source gives it. No global id format: an index keys items by `source.connector`, `source.instance` and `id` |
| `source` | `{ connector, instance }`: the connector plugin's id and its instance (`default`, `work`) |
| `kind`, `title`, `updatedAt` | One of the kinds below; one line for a list; when the source last changed it |
| `createdAt`, `deepLink`, `body`, `raw` | Optional: when it was made, the URL back to the original app, its text, everything else the source said |

Times are RFC 3339 with an offset (`Z`, `+09:00`). Kinds keep few fields of their own; the rest goes in
`raw`, which views may read (`raw.labels`) and nothing else depends on. A person in an item is
`{ name?, email? }`, at least one of them.

| Kind | Its fields (`?` optional) |
| --- | --- |
| `event` | `start`, `end`, `allDay?`, `location?`, `attendees?`, `recurrence?` (the RRULE, kept as written), `calendar?` |
| `message` | `from`, `to?`, `receivedAt`, `unread`, `snippet?`, `thread?` |
| `task` | `status` (`open`, `done`, `cancelled`), `due?`, `completedAt?`, `priority?` (1 most urgent to 4), `project?` |
| `note` | `path?`; the text is `body` |
| `file` | `path`, `size` (bytes), `mime?`, `modifiedAt` |
| `person` | `emails?`, `phones?`, `org?` |
| `entry` | A feed entry: `url`, `feed`, `publishedAt`, `summary?` |
| `metric` | A time series: `series`, `unit?`, `points` (`{ t, v }`, oldest first) |
| `record` | Any other shape: `schema` (the URI of the JSON Schema it follows) and `fields` |

`ItemQuery` narrows by `kinds`, `sources` (a connector id, `connector/instance`, or `$name` in a view
binding), `text` (full-text search) and `where` conditions, all of which must hold. A condition is
`{ field, op, value }`: `field` is a dotted path into the item (`start`, `raw.labels`), `op` is `eq`,
`ne`, `lt`, `lte`, `gt`, `gte`, `in` (an array of values), `contains` (a substring or an element) or
`exists` (no value, or `false` for a missing field). `sort` is `[{ field, dir }]`, newest `updatedAt`
first when absent. A page holds `limit` items, 50 by default and 500 at most; its opaque `cursor` asks
for the next. `ItemChange` is `upserted` with the item, or `removed` with its source and id.

`vectors/` holds valid and invalid items, queries, pages and changes for the contract tests.
