---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# A followed foreign key opens a table view under quick filters

## Context and Problem Statement

PG-41 (#468) asks that the result grid of `endue.database` follow foreign keys on PostgreSQL: from a key
cell to the row it points at, from a row to the rows that point at it, and back. Editing a key cell should
let the person pick the referenced row instead of typing its key. The grid (ADR 0288) already has quick
filters that a table view sends to the server as WHERE terms, names quoted and values literals; the schema
cache (ADR 0285) already knows each held table's foreign keys. What does a followed key open, where do the
keys come from when the cache does not hold a table, how does back restore a view, and how does a search
of a referenced table work in a page whose dialogs cannot call back into the plugin?

## Decision Drivers

* No raw text spliced into SQL: every name quoted, every value a literal, as the quick filters already do
* One row's keys found without a full catalog read, and the same answer for both directions
* A followed view is an ordinary table view: it pages, sorts, edits and filters as any other
* Back shows the view as the person left it, filters, order, sort keys and page included
* A referenced table of a million rows is searched without reading it whole
* A key of two or more columns is set as a whole, and never half set

## Considered Options

* Open the referenced table's view under one `=` quick filter per key column
* Open a console with a generated SELECT
* Write the key's condition into the table view's typed WHERE

## Decision Outcome

Chosen option: "the table view under quick filters", because a filter chip says what keeps the row, the
person can remove it with one key to see the whole table, and the filters already build their SQL with
quoted names and literal values. A console would leave the view's paging, editing and column state behind;
a typed WHERE would be text the plugin wrote and the person then edits as raw SQL.

* A key is followed (`g`, Mod+click, the cell's menu, `endue.database.follow-key`) from the grid's cursor in
  a PostgreSQL table view or a console's plain SELECT of one table. The referenced table's view opens, or
  the open one is reused, with its typed WHERE cleared and one `eq` filter per key column holding the
  cursor row's value as the grid shows it, pending changes included. A key whose columns are not all in the
  result, or whose value is NULL, says so and opens nothing. A column in two keys asks which.
* The rows pointing at a row (`r`, the menu, `endue.database.referencing-rows`) are listed by referencing
  table, sorted by schema and name. Their counts run only when asked, as one run of one `count(*)` per key.
  The chosen one opens the same way, filtered on the referencing columns.
* The keys of a table come from the schema cache when it holds the table's schema; the keys pointing at it
  are those of every schema the cache holds. Otherwise one `pg_constraint` read answers both directions,
  with names and values quoted as literals and a partition's copies of a key (`conparentid <> 0`) left out.
* Each follow pushes where it came from on a trail kept in memory: the buffer, and a table view's WHERE,
  ORDER BY, sort keys, filters and offset. Back (`b`, `endue.database.go-back`) shows that buffer and, when
  its state changed since, sets it back and reads the page again. Views closed since are skipped and
  counted. The trail keeps 50 steps and does not outlive the plugin.
* Editing a key cell (Enter, F2 or a double click, `endue.database.pick-key`) opens the palette over the
  referenced table: 50 rows a page ordered by the key, each with the table's first text column outside the
  key, a More rows item, typed text searched on the server with ILIKE over the key and that column, and
  for a key of one column the typed text as it is. The pick sets every column of the key as one pending,
  undoable step, so a composite key is never half set; nothing runs until Submit.
* A key's cells are drawn as links (link text, underlined) with a title saying where they point. The grid
  asks the controller once per result after drawing it, and a later result's question wins.

### Consequences

* Good, because a followed view is a view: Submit, paging, sorting, column state and exports all work there
* Good, because the SQL of every step is built by the same quoting the filters and the cache use
* Good, because a big referenced table is searched a page at a time on the server
* Bad, because the search runs in the palette and not in a form beside the cell: the palette is the only
  surface that can ask the plugin again while open, since a dialog's model is cloned and cannot call back
* Bad, because following into a view that is already open replaces its filters; back restores them, but a
  second follow into the same view from elsewhere replaces them again
* Bad, because keys of MySQL and SQLite are not followed yet; the commands say so on those connections

### Confirmation

`plugins/database/tests/links-model.test.ts` (keys from the cache and from rows, the SQL of both reads,
filters, titles, the trail), `links-feature.test.ts` (follow, a composite key, a self-reference walked
back, referencing rows counted, the search over two pages and with text, the pg_constraint fallback, the
refusals), `links-grid.test.ts` (link cells, keys, Mod+click, Enter and the menu on jsdom),
`links-live.test.ts` on a real PostgreSQL, and `packages/runtime/e2e/database-links.spec.ts` in the page.

## More Information

`plugins/database/ui/links/model.js` (keys, filters, search SQL, trail), `links/grid-links.js` (the grid's
side), `ui/features/links/` (`read.js` the source table and keys, `follow.js` follow, referencing and
back, `pick.js` the search). The filters are ADR 0288's; the cache is ADR 0285's.
