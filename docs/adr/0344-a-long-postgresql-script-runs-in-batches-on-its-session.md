---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# A long PostgreSQL script runs in batches on its session

## Context and Problem Statement

Since ADR 0281 the database plugin runs each statement of a PostgreSQL script as one `db.run`: a call
from the plugin's frame through the bridge to the core, which hands it to the session's task and waits
for the answer. For a script of thousands of small statements (a dump's INSERTs, a migration) that
crossing costs more than the server's work, and under load each one took 1.3 to 7.6 ms, against 1.5 to
1.9 ms for the whole statement in `psql`: a 1 MB script of 10,201 INSERTs took about twice as long as it
did through `psql`. How does a long script cross the bridge fewer times while every statement keeps its
own outcome?

## Decision Drivers

* A long script is not slower on the desk's sessions than through `psql`
* Each statement keeps what it has today: its rows, its notices (ADR 0334), its error with its
  position, and the first error stopping the run with what ran before it said
* Cancel stops a run where it is, between statements as well as in one (PG-81's per-run signal)
* What one statement does stays its own: each commits as it did, a transaction the script opens stays
  the session's, and statements that cannot run in a transaction block (VACUUM, CREATE DATABASE) run
* An additive change to the bridge's contract (v0)

## Considered Options

* `db.script`: the statements in one call, the core running them one by one on the session (chosen)
* Pipeline the statements by the extended protocol with one Sync at the end
* Send the script as one simple Query
* Keep `db.run`, and run several at once from the frame

## Decision Outcome

Chosen option: "`db.script`", because it removes the cost that was measured (the bridge crossing and
the hand-over to the session's task) and changes nothing the server sees: each statement is still
Parse, Bind, Describe and Execute, then Sync, one after another on the same connection. Inside a
script a statement's Sync goes out in the same write as the next statement's messages, so a statement
costs one round trip to the server instead of two, as one `psql` statement does; the ReadyForQuery
that answers it, and a notice or FATAL raised at that statement's commit, stay that statement's.

* `db.script { sessionId, statements: [{ sql, params?, paramTypes? }], goOn?, pageRows?, pageBytes? }`
  runs the statements in order, each as `db.run` runs one, and answers `{ pages, cancelled?, failure? }`:
  each statement's first page, with the notices it heard. It stops after a page with `more` (the
  result, or a COPY FROM STDIN, stays open for `db.fetch` and `db.copy`), at the first error unless
  `goOn`, at a FATAL, and at a `db.cancel`. A failure that is not the server's (the connection gone, a
  row over the limit) is `failure`, the bridge error `db.run` would have answered, and belongs to the
  statement after the last page. While it runs the session is busy as in one statement.
* `db.cancel` sends the server's cancel and also marks the call, so a script stops before its next
  statement even when the cancel reaches the server between two.
* The plugin (`engines/pg-script.js`) sends consecutive statements in batches of at most 200 statements
  and 1 MiB of SQL; a batch of one is a `db.run`. A page with rows left is read on and closed as before,
  then the rest of the script goes on from the next statement. BEGIN, COMMIT and the savepoints of a run
  in one transaction or a dry run stay `db.run`s of their own around the batches. The statement
  timeout's backstop covers a batch for the statement timeout times its statements, plus five seconds.
* Console runs, a `.sql` file run part by part (ADR 0286) and anything else that runs a script through
  `deps.execute` take the batches with no change of their own; progress and Cancel are as they were.

### Consequences

* Good, because a script of many small statements crosses the bridge once per 200 statements: measured
  in the pull request, 2,000 and 10,201 INSERTs run several times faster than before and no slower
  than `psql`.
* Good, because the server sees what it saw before, so a statement's outcome, its notices and how it
  commits do not change.
* Bad, because a statement's outcome reaches the frame with its batch, not as it finishes; nothing
  shows one statement's outcome before the run ends today.
* Bad, because Cancel between two statements of a batch lets at most the statement already sent finish
  (as it did before), and a batch's backstop is longer than one statement's.

### Confirmation

`crates/desk-pg/tests/live_script.rs` runs scripts against a real server: pages and notices in order
(a notice raised at a statement's commit included),
the first error stopping unless `goOn`, a result with pages left and a COPY in stopping open, a
transaction kept, a cancel stopping the script, a FATAL as its page. `packages/bridge/src/
stub-db-script.test.ts` checks the browser stub's copy. `plugins/database/tests/pg-script-batches.test.ts`
and `script-batches-live.test.ts` check that a script goes in batches and that each statement keeps its
outcome, error, position and notices, and that Cancel stops a batch.

## Pros and Cons of the Options

### `db.script`, one by one in the core

* Good, because nothing changes on the server's side.
* Neutral, because each statement still waits for the server once: what `psql` does too.
* Bad, because the Sync sent with the next statement needs care: what it answers belongs to the
  statement before (`crates/desk-pg/src/script.rs`).

### Pipeline with one Sync

* Good, because it saves the server's round trips as well.
* Bad, because statements between Syncs run in one implicit transaction: an error would roll back the
  statements before it, and VACUUM or CREATE DATABASE refuse to run.

### One simple Query

* Bad, because a multi-statement Query also runs as one transaction, and its results lose their
  statement positions and the paging of a large result.

### Several `db.run`s at once

* Bad, because a session runs one statement at a time; the calls would still wait for each other.
