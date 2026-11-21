---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# Query plans are read per node, remembered per connection and paired to compare

## Context and Problem Statement

`endue.database` drew a PostgreSQL plan as a tree of cost, rows and a share bar, from a fixed
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. Reading a slow plan needs more: the estimate against what
each node returned, its own time apart from its children's, the reason in words, the options the
server has, and the plan before and after a change side by side (PG-70 of the PostgreSQL plan).
What does the plugin read from a plan, what does it keep, and how are two plans lined up?

## Decision Drivers

* The same tree model for every engine, so the tree, a flame and a table draw from one reading
* ANALYZE runs the statement: a write must change nothing and pass every guard a run passes
* Options differ by server version (WAL from 13, GENERIC_PLAN from 16, SERIALIZE and MEMORY from 17,
  BUFFERS on by default with ANALYZE from 18), and a server refuses one it does not have
* Two plans of one statement rarely have the same shape; node ids do not exist in the JSON
* A plan of a partitioned table can be megabytes of JSON; the frame's thread stays free

## Considered Options

* Pairing: children by type and relation, then by relation, then by position; a text diff of the
  two EXPLAIN texts; matching every node by its label across the whole tree
* Options: remembered per connection; one global setting; asked every time
* Flame: an icicle of each node's own time; an icicle of total time; a timeline

## Decision Outcome

Chosen: read each node's totals over all its loops, mark a misestimate of ten times or more (high at
a hundred), remember the options per connection, pair children level by level, and draw the icicle
of own time, because each keeps one model that every view reads and says what a person acts on.

* A node's rows and time are its per-loop numbers times its loops; its misestimate is the actual
  rows per loop over the estimate. Marks with fixed thresholds: a sequential scan that filters 90% of
  1,000 rows or more away, a sort, hash or aggregate that spilled (its own temporary blocks, not its
  children's), an inner side that ran 1,000 times, an index scan whose filter removed at least 100
  rows and at least as many as it kept. A write's own row count is never a misestimate.
* The options are those of the server's version, read once a session with `SHOW
  server_version_num` (13 when that fails), and kept in the plugin's store as `explain:<connection>`.
  An option the server turns on with ANALYZE and the person turned off is sent as `FALSE`.
* ANALYZE of a write runs as the console's dry run through `deps.execute`: in a transaction rolled
  back at the end, refused on a read-only connection, asked on production and for an agent.
* Two plans pair the root, then each node's children; what is left is added or gone. A change is a
  node type, or cost or time moved by 20% or more (time also by more than 0.05 ms).
* A JSON plan over 64 KiB is read in a worker; below that the worker's start costs more than the read.
* Features gain `dialogs`, drawn inside the page by the view, so the options dialog lives in
  `ui/features/plans/` beside the compare panel.

### Consequences

* Good, because the tree, flame, table, copy and compare read one `PlanNode` tree, MySQL's and
  SQLite's plans included, and a new mark is a function of a node.
* Good, because the options that fail on an old server are never offered.
* Bad, because a rolled-back write still advances sequences and runs a function's effects outside
  the database; the dialog says ANALYZE runs the statement.
* Bad, because pairing by level misreads a plan whose join order flipped deeply: the nodes below show
  as changed rather than moved.
* Bad, because the thresholds are fixed; a setting for them is left until someone asks.

## More Information

Issue PG-70 under the PostgreSQL plan; ADR 0038 (the engines' own clients), ADR 0048 (workers).
No section of `docs/ko/desk-structure.md` changes.
