---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# The result grid keeps its columns by name, and says where its filters run

## Context and Problem Statement

`endue.database`'s grid (#469, PG-42) hides, moves, pins and resizes columns, sorts by more than one
column, keeps the rows of a quick filter (equals, contains, empty, NULL...) and finds text in the
result. A table's view already filters (WHERE) and orders (ORDER BY) on the server and pages; a
console's result holds its rows in the frame, up to 100,000 of them and hundreds of columns wide.
Three things are hard to change once people rely on them: what a table's column state is kept as and
where, what a quick filter or a sort key becomes in a table's view, and where the frame's sorting,
filtering and finding run.

## Decision Drivers

* A table's view opens with the columns as they were left, after a restart too
* A kept state that still fits after the table gains, loses or renames a column
* The WHERE and ORDER BY the person typed stay theirs, readable and editable as typed
* The grid says which filters and keys run on the server and which on the rows on screen
* No copy of the rows for an order, a filter or a find; the frame stays responsive at 100,000 rows
* Every operation a key, a pointer gesture and a palette command alike

## Considered Options

For the column state:

* The plugin's store, one key per table, columns by name
* The buffer's state (`desk.buffers`), gone when the table's view is closed
* By column position, as the grid draws them

For a table view's quick filters and sort keys:

* Filters kept apart and joined after the typed WHERE; keys written into the Order field
* Both written into the WHERE and Order fields as text
* Both applied to the page on screen only

## Decision Outcome

Chosen options: "the plugin's store, by name" and "filters joined after the typed WHERE; keys into
the Order field", because they keep the state through restarts and schema changes and never rewrite
what the person typed, while the Order field already holds the server's ORDER BY that `s` set.

### The kept state

A table's view keeps `grid:<connection id>:<schema>.<table>` in the plugin's store (`store.set`),
300 ms after the last change:

```json
{ "v": 1, "order": ["id", "name"], "hidden": ["note"], "pinned": ["id"], "widths": { "name": 160 } }
```

A column's key is its name; a name that repeats in a result is `name#2`, `name#3` from its second
use. `order` lists keys in screen order, pinned ones first; keys the result lacks are kept but not
drawn, and columns the state does not name go at the end, shown. Widths are CSS pixels from 40 to
1200; a fitted width is the longest of the name and the values (cut at 100 characters). A state
that is not `v: 1` or not of this shape reads as none. A console's result keeps its state by
`result:<console>:<run>:<tab>` in memory while it is among the last 20; a restart forgets it.
Resetting the columns clears the state.

### Filters and keys on the server

A filter is `{ key, name, op, value, numeric }` with `op` one of `eq`, `ne`, `gt`, `lt`, `contains`,
`empty`, `null`, `notNull`. A table view runs `(<typed WHERE>) AND <filter> AND ...`, and its row
count the same; the WHERE field keeps only what was typed. Names are quoted for the dialect and
values are literals: a number bare in a numeric column, else a quoted text. `contains` is
`CAST(c AS text) ILIKE '%v%' ESCAPE '!'` in PostgreSQL, `CAST(c AS CHAR) LIKE` in MySQL and `c LIKE`
in SQLite, with `!` escaping `%`, `_` and itself. `empty` is `c = ''`.

Sort keys are `{ key, name, direction }`. In a table view they become the Order field's ORDER BY
(`"team" ASC, "id" DESC`), so it shows what runs; an ORDER BY typed there that differs drops the
keys. The header numbers the keys when there are several (▲1, ▼2); `aria-sort` is on the first key
only, as ARIA allows one, and the others say their place in words.

The strip over the grid lists the filters as chips with Remove, after "On the server" for a table's
view or "On these rows" for a console's result.

### Where the frame's work runs

Order, filters and find work on row indexes over the result's own rows, never copies. Up to 10,000
rows they run in the frame; past that in a worker (`ui/grid/worker.js`, started with the SDK's
`startWorker` as the output worker is), which is sent each column it needs once per result and the
pending edits with each request. A collator sort of 100,000 strings takes about 200 ms, which is
too long for the frame's thread. Only the rows and columns in view are drawn: the pinned columns
stick at the left, the ones scrolled past are one empty track.

### Consequences

* Good, because a table's view opens as it was left and survives added and dropped columns.
* Good, because the typed WHERE and the quick filters stay apart: removing a chip never edits text.
* Good, because the Order field always shows the server's ORDER BY.
* Bad, because a renamed column loses its width and place (it is a new name).
* Bad, because a quick filter in a table's view is not in the WHERE field to copy; its chip is the
  record of it.
* Neutral: a console's result forgets its columns on restart, as it forgets its rows.

### Confirmation

`plugins/database/tests/grid-columns.test.ts`, `grid-rows.test.ts`, `grid-server.test.ts` and
`grid-view.test.ts`, and `packages/runtime/e2e/database-grid.spec.ts`.

## More Information

Issue #469 (PG-42) of the PostgreSQL plan (#438). The worker pattern is the output reader's (#38).
