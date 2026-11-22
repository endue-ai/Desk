---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# SQL warnings are a kind of the problems check, off by identifier or by a comment

## Context and Problem Statement

PG-36 (#466) points out statements the server runs that are likely mistakes, while they are
written: `= NULL`, a join with no condition, `SELECT *` in a view or an INSERT ... SELECT, a column
cast to compare it, `NOT IN` over a nullable subquery, UPDATE or DELETE without WHERE, LIMIT without
ORDER BY, a function over an indexed column, INSERT without a column list. PG-30 (ADR 0294) already
checks each statement in the parse worker against the schema cache. Where do the warnings run, how
does a person turn one off for good or for one line, and when may the editor rewrite the text? A
warning that is wrong teaches the person to ignore all of them, and a fix that changes the meaning
is worse than none. Also, ADR 0290 left a gap: a console statement calling `pg_terminate_backend`
classified as a read.

## Decision Drivers

* No second parse and no second cache: the statement is parsed once for problems and warnings
* Silence where the cache cannot tell (a column's type, NOT NULL, the indexes)
* A fix only where it cannot change more than the warning says
* Turning a warning off is written where the person reads it, and survives in a `.sql` file
* The run's guards treat a session signal as a change to the server

## Considered Options

* A fourth kind (`warning`) of the PG-30 check, computed from the same tree and resolved names
* A separate lint pass on the page over the parse worker's trees
* Asking the server (EXPLAIN) for the type and index questions

## Decision Outcome

Chosen option: "a fourth kind of the PG-30 check", because the tree, the names and the cached model
are already in the worker, kept per statement, so an edit checks only what changed.

* `ui/diagnose/warnings.js` runs eleven rules over each statement (`warn-null.js`, `warn-joins.js`,
  `warn-statements.js`, `warn-types.js`): `null-comparison`, `join-without-condition`,
  `select-star`, `column-cast`, `not-in-null`, `update-without-where`, `delete-without-where`,
  `limit-without-order`, `function-on-indexed-column`, `insert-without-columns`, `server-signal`.
  Each is a warning with its identifier and a one-line reason; the editor draws it as a warning.
* The model (`diagnose/model.js`) carries a column's NOT NULL and a relation's index definitions
  from the cache; the worker parses each definition once. A column is told cast only where
  PostgreSQL has no operator for the pair and casts the column side (integer against numeric or
  float, numeric against float, character(n) against text or varchar); the live test reads the
  cast in EXPLAIN's plan. A function warns only over a column that leads a btree or hash index,
  and not when an expression index names the column. NOT IN warns over a column the cache says
  can be NULL, never over one it does not know.
* Fixes: `= NULL` and `<> NULL` become `IS NULL` and `IS NOT NULL` (in the case NULL was written
  in; with NULL on the left only before a column), and INSERT gets the cached columns, as many as
  it has values. Nothing else has one. A fix is refused when its text changed since the check.
* Off: `problems-warnings` turns all off; `problems-warnings-off` lists identifiers.
  `-- endue-ignore [identifiers]` (or `/* endue-ignore */`) turns them off for its line when the
  line has code, else for the next line; with no identifier, every warning there. Errors are never
  turned off. A statement that ran keeps its warnings.
* `ui/sql/classify.js` makes a PostgreSQL statement that calls `pg_cancel_backend` or
  `pg_terminate_backend` (EXPLAIN ANALYZE too) a write: read-only refuses it, production asks, an
  agent's run waits for the person. This closes ADR 0290's gap. No new confirmation sentence.
  The activity panel's cancel and end keep their own question (with the session's statement) and
  pass `asked`, so the person is asked once; the read-only refusal still holds.

### Consequences

* Good, because warnings cost one walk per rule over a tree already parsed, and come with the
  problems' 300 ms pause, F8 and the list.
* Good, because the ignore comment travels with the script and is plain SQL to the server.
* Bad, because LIMIT without ORDER BY also marks a quick look at a table (`SELECT * ... LIMIT 10`);
  the setting or the comment turns it off.
* Bad, because a stale cache can warn of an index or a nullable column that changed elsewhere,
  until the cache reads the schema again.
* Neutral, because a dry run of a signal still runs it: a signal cannot be rolled back.

### Confirmation

`plugins/database/tests/warnings.test.ts` (each warning on its case and near miss, the fixes, the
setting and the comment, a 1 MB script), `warnings-editor.test.ts` (jsdom),
`classify-signals.test.ts`, `warnings-live.test.ts` on a real PostgreSQL,
`packages/runtime/e2e/database-warnings.spec.ts`.

## More Information

Issue #466 (epic #438). ADR 0294 (the problems check), 0290 (session signals), 0285 (schema cache).
