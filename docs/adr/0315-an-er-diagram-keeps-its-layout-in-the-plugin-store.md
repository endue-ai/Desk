---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# An ER diagram keeps its layout in the plugin's store

## Context and Problem Statement

PG-55 (#479) lets the person drag the tables of an ER diagram in `endue.database` and expects them where
they were left: when the diagram opens again, and after the desk restarts. The diagram is a feature panel
(`plugins/database/ui/features/diagram/`), and a feature panel has two places to keep something across a
restart: its `keep(state)`, the small JSON that comes back with the buffer, or the plugin's store
(`store.get` and `store.set`, 64 KiB of JSON a key). A diagram of 500 tables holds 500 positions, and the
same diagram may be opened from the explorer, the palette or a key while no buffer of it is open. Where is
a diagram's layout kept, under which name, and what happens to tables that come and go?

## Decision Drivers

* A layout outlives its panel: closing the panel and drawing the same schema again shows it as left
* One diagram is the same diagram from the explorer, the palette and an agent's command
* 500 tables fit, and a record past a key's 64 KiB is neither cut short nor read half-written
* A table added to the database, or dropped, never moves a table the person placed
* A store key is lowercase and at most 64 characters, whatever the connection and schema are called
* Nothing of the database's data is kept: names and positions only

## Considered Options

* The plugin's store, one record per connection and diagram, keyed by a hash of both
* The panel's `keep(state)`
* A file beside the connection's settings

## Decision Outcome

Chosen option: "the plugin's store, one record per connection and diagram", because `keep` belongs to an
open buffer (a diagram closed and drawn again would start over, and `keep` is meant for small JSON), and a
file needs a path grant for what is the plugin's own state.

* A diagram is named by its connection and its choice: its schemas (`public`, `public, sales`), a filter
  (`public matching "ord"`) or a table and a depth (`public.orders ±2`). The panel shows `er: <connection> ·
  <name>`, and the same name opens the same record.
* The key is `diagram.<h1>.<h2>`: FNV-1a in base 36 of the connection id, and of the id with the name.
  The record says its version (1), connection and name, and a read whose connection or name does not match
  (a collision) or whose version is another is no record.
* The record holds the choice, the columns shown (all, keys, none), the positions as
  `[schema, table, x, y]`, the tables added and removed by hand, and the relations drawn by hand. No column,
  no row, no comment.
* Up to 60 KiB it is one key. Past that, the head key holds a stamp and a count and the text goes in up to
  8 chunks (`<key>.0` … `<key>.7`) that each carry the same stamp; a chunk with another stamp, as an
  interrupted write leaves, makes the whole record unread. Past 8 chunks (about 480 KiB, some 8,000
  tables) nothing is written and the person is told the layout lasts until the plugin restarts.
* A move is written 400 ms after the moves stop, and at once when its panel closes or the page goes away.
* When it opens, a table with a kept position stays there; a table without one (new in the database, or
  newly shown) is laid out with the others new and placed right of every kept table, so nothing placed
  moves. A dropped table has no box and its position leaves the record at the next write. Auto layout
  forgets the positions and lays everything out again.

### Consequences

* Good, because a diagram looks the same however it is opened, and an agent's command draws what the
  person sees
* Good, because a schema change never undoes the person's arrangement
* Bad, because the store has no list: records of a deleted connection stay until the plugin's data is
  cleared. They hold names and numbers only
* Bad, because a diagram whose choice changes (another depth, another filter) is another diagram with a
  layout of its own; the record of the old one stays
* Bad, because positions kept for one column mode may overlap after switching to a taller one; Auto layout
  fixes it, and the switch never moves a placed table by itself

### Confirmation

`plugins/database/tests/diagram-kept.test.ts` (keys, chunks, a torn chunk, another version, the cap),
`diagram-feature.test.ts` (a move kept, the diagram drawn as left after a restart, a new table placed
beside), `diagram-layout.test.ts` (kept positions stay, new tables right of them), and
`packages/runtime/e2e/database-diagram.spec.ts` in the page.

## More Information

`plugins/database/ui/features/diagram/kept.js` (the record), `read.js` (positions in, record out),
`controller.js` (debounced writes). The export of a diagram writes through `dialog.save` and `fs.write`,
asking for the path once when it is not granted (ADR 0260). The tables come from the schema cache's public
view on PostgreSQL (ADR 0285).
