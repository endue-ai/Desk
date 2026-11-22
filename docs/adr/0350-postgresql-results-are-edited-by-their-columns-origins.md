---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# PostgreSQL results are edited by their columns' origins, and keys that are not unique are guarded

## Context and Problem Statement

The grid could change only a plain `SELECT` of one table with its primary key in the result (ADR 0115):
the plugin read the statement's text to find the table. Since PostgreSQL runs on the core's sessions
(ADR 0281), every result column carries the table OID and column number the server's row description
gives it. People want to edit a join, a table without a primary key and an updatable view. How does the
plugin know for sure which row of which table a cell is, and what does it do when a table's rows cannot
be told apart by a key?

## Decision Drivers

* A change lands on exactly the row it was made on, or is refused; never on another row
* One Submit stays one transaction (ADR 0115)
* No core or spec change: the session already sends the origins
* Every cell that cannot change says why

## Considered Options

* Map columns by the row description's origins, read the tables by OID from `pg_catalog`, key each table
  by its primary key, a unique NOT NULL index, its `ctid` when selected, or every column, the last two
  guarded to change exactly one row (chosen)
* Parse the statement (joins, aliases) and match result names to tables' columns
* Refuse tables without a primary key, as before

## Decision Outcome

Chosen option: "map by origins, guard the keys that are not unique", because the server, not a parser,
says where a column comes from, and a guard makes a key that may match several rows safe.

* A PostgreSQL result whose columns name a table is mapped column by column (`ui/edit/origin-target.js`).
  The tables are read by OID in one catalog statement at the first edit (`ui/edit/origins.js`): columns,
  unique indexes that can key rows, foreign keys, `pg_relation_is_updatable` and `pg_column_is_updatable`.
  The schema cache is not used: it may be older than the table, and a key read from it could be gone.
* Origins say which table, not which instance of it: a table the statement names more than once (a
  self-join, a subquery or a WITH query over the same table, a WITH query read twice) stays read-only.
  Only a statement that reads is mapped, so reading the rows again after Submit writes nothing.
* A table is keyed by its primary key; else a unique index that is not partial, has no expressions and
  whose columns are NOT NULL; else its `ctid` when the result selects it (ordinary tables; a partitioned
  table's `ctid` repeats across partitions); else every one of its columns when all are in the result.
* A change keyed by `ctid` or by every column runs as `WITH changed AS (... RETURNING 1)` whose count must
  be 1, else the statement fails (an integer cast of "N rows matched") and the transaction rolls back. The
  plugin says whether the row moved (0: its `ctid` changed on an update or VACUUM FULL) or could not be told
  apart (2 or more). Values are compared by their output text (`pg_catalog.format('%s', col)`), as the grid
  holds them, so a type without equality compares too; a mismatch can only refuse, never widen.
* A join's row changes as one UPDATE per table; updates run parents first by foreign key. A join takes no
  new or deleted rows. A primary or unique key keeps ADR 0115's rule: a change that matched no row is said.

### Consequences

* Good, because a join, a table without a key and an updatable view become editable without a parser.
* Good, because two equal rows without a key can never both change from one edit.
* Bad, because a key by values refuses rows whose output text the server writes differently on another
  session's settings; selecting a key or `ctid` avoids it.
* Bad, because a table named twice in the text is read-only even when a person could tell its instances
  apart; the reason says so.

### Confirmation

`plugins/database/tests/edit-origins.test.ts` and `edit-joins.test.ts` pin the mapping, the keys, the
guard and the order; `edit-joins-live.test.ts` runs a join, a table without a key with two equal rows, a
moved row, a unique index and views against a real PostgreSQL; `packages/runtime/e2e/database-edit-joins.spec.ts`
edits a join in the grid.
