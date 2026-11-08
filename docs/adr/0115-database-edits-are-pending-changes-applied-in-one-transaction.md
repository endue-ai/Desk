---
status: accepted
date: 2026-11-08
decision-makers: Team endue
---

# Database edits are pending changes applied in one transaction

## Context and Problem Statement

The Database plugin (`plugins/database`, ADR 0038) shows results in a grid and now lets people
change them there, as DataGrip does: change a cell, add a row, delete rows. The plugin has no driver:
every run is one process of the engine's own client (psql, mysql or mariadb, sqlite3), one
connection, and a transaction cannot span two runs. Values arrive as text, so types come from the
catalog. How do edits in the grid reach the database so that a half-applied set of changes, a
change that lands on the wrong row, or a value that becomes SQL are impossible?

## Decision Drivers

* All of a person's changes are applied, or none: no half-edited table after a failure
* Each change lands on exactly the row it was made on
* A value is always data: nothing typed in a cell can become SQL
* The guards of every run stay: read-only connections refuse, production connections ask
* Keyboard first, and the person sees what will run before it runs
* No core or spec change, no driver (ADR 0038)

## Considered Options

* Pending changes, shown as a diff, written as dialect SQL and applied in one transaction on Submit
* Apply each edit at once, as its own statement in its own run
* Generate a script into the console for the person to run

## Decision Outcome

Chosen option: "pending changes applied in one transaction", because it is the only one where a
failure leaves the table as it was and the person decides when the changes are made.

* Edits wait in the result's pending changes (`ui/edit/pending.js`): changed cells by row and
  column, added rows, rows marked for deletion. The grid draws them as a diff; Preview shows the SQL;
  Revert drops them; a new run of the console asks before it drops them.
* A result can be changed only when it is one table's rows: a table's view, or a console's plain
  `SELECT ... FROM` one table (no join, grouping, DISTINCT, set operation, subquery in FROM;
  `ui/edit/source.js`), with every primary key column in the result. The key comes from the catalog.
  A result without a primary key, a key column missing from it, or a NULL in it refuses edits, and
  so does a read-only connection, before anything runs.
* Submit writes deletes, then updates, then inserts. Each UPDATE and DELETE is keyed on the primary
  key's values as the server sent them (the old value when the key itself is changed). Each value is
  a literal of its column's dialect and type (`ui/edit/values.js`): NULL, a number in a numeric
  column, the dialect's hex literal for bytes, else a string quoted by the dialect's rules
  (`sql/quote.js`), never raw text.
* The statements run as one run in the executor's transaction mode, so every run's checks apply:
  the read-only refusal, the production question, the password prompt. psql runs them under
  `--single-transaction` with `ON_ERROR_STOP`, which sends ROLLBACK at the first error; sqlite3 under
  `BEGIN ... COMMIT` with `-bail`, and the mysql client under `START TRANSACTION ... COMMIT`, both
  stopping before COMMIT so the server rolls the open transaction back when the session ends.
* After a commit the rows are read again. An UPDATE or DELETE that matched no row is said by its row
  ("changed or went since it was read"); the rest are committed.

### Consequences

* Good, because a failure (a constraint, a type, a lost connection) leaves nothing applied, and the
  pending changes stay for the person to fix and submit again.
* Good, because the SQL is the person's to read before it runs, and the same SQL is what Copy as
  SQL INSERT or UPDATE writes.
* Good, because every guard is the one every run has: nothing new to keep in step.
* Bad, because a row that changed on the server since it was read is still overwritten by an
  UPDATE keyed on its primary key; only a row that no longer matches is reported. Optimistic checks
  on every column are a follow-up.
* Bad, because MySQL's tables in a non-transactional engine (MyISAM) cannot roll back; the changes
  before a failure stay there. The confirmation does not say so yet.
* Bad, because MySQL counts an UPDATE that sets a value equal to the old one as matching no row
  (rows affected, not rows found), so "matched no row" can be said of such a change.
* Bad, because editing needs a primary key: a table without one is read-only in the grid.

## More Information

`plugins/database/ui/edit/` (pending, source, submit, values), `ui/edits.js`, the grid
(`ui/view-grid.js`), `plugins/database/tests/pending-changes.test.ts` and `sqlite-e2e.test.ts`,
`docs/ko/database-plugin-requirements.md` (DB-14), ADR 0038.
