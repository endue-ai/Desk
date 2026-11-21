---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# Maintenance runs alone, outside a transaction block, and cancels its own session

## Context and Problem Statement

PG-73 (#489) runs VACUUM, ANALYZE, REINDEX and CLUSTER from a form in `endue.database`. VACUUM,
REINDEX CONCURRENTLY, REINDEX of a schema or a database and CLUSTER of a database or a partitioned
table refuse to run inside a transaction block, and VACUUM FULL, CLUSTER and REINDEX without
CONCURRENTLY block a table's reads or writes for the whole run. The plugin runs `psql` once per run
(ADR 0038) and hands its output over at the end; its cancel stops every job it runs. How does the
statement reach the server, which guards apply, how does the person see a long run and stop it, and
what can an agent or another feature do with it?

## Decision Drivers

* The person never sees "cannot run inside a transaction block" for a statement the form wrote
* What a statement locks is said before it runs, in words, with the target's size
* A read-only connection never runs one; production says so first; an agent waits for the person
* A run that waits for a lock or takes minutes shows where it is, and stops on the server, not
  only in the plugin
* PostgreSQL 13 and later; a standby cannot run them

## Considered Options

* The statement alone through the executor in run mode, progress from `pg_stat_progress_*`, cancel
  with `pg_cancel_backend` of the run's own session
* The same, but cancel by stopping the plugin's `psql` (the runner's cancel)
* Wait for the core's PostgreSQL session (ADR 0281) and stream the output from there

## Decision Outcome

Chosen option: "the statement alone through the executor in run mode", because it runs on today's
runner, keeps one set of guards for every statement that changes the server, and stops the run on
the server whichever way it is waiting.

* The form writes exactly one statement and sends it through `deps.execute` in run mode: psql gets it
  as its own `-c`, never with `--single-transaction`, so the server runs it outside a transaction
  block; a schema's VACUUM and ANALYZE name its tables in one statement.
* The executor's guards are the ones that apply (the classifier reads all four as DDL): a read-only
  connection refuses (the form says so and its Run is off), production asks naming it while the
  `confirm` setting is on, and an agent's run (`endue.database.maintenance` with `run`) always waits
  for the person's yes. The command is an agent tool, not `irreversible`: nothing it runs loses data.
* The form says in words which lock each statement takes and what waits for it, for a moment or for
  the whole run, the room a copy needs and the lock queue, and turns into a warning when reads or
  writes wait for the whole run. Options the version lacks are left out; options another rules out
  are disabled with why.
* While it runs, the form reads its session every 1.5 s: `pg_stat_activity` (its wait and
  `pg_blocking_pids`) with the four progress views, found by the plugin's application name, this role,
  this database and the statement text (`starts_with`, as the server cuts a long one).
* Cancel is `pg_cancel_backend` of that session only: the run ends with the server's "canceling
  statement due to user request", and the plugin's other jobs go on. A session not found is said.
* The statistics (`pg_stat_user_tables`, sizes, the last runs) are read before and after, with a 2 s
  `lock_timeout` so a read never queues behind the run's own lock request. VERBOSE output and notices
  show when the run ends; streaming them waits for the core's session (ADR 0281).
* `endue.database.maintenance` takes a connection, a schema, a table or an index, an operation,
  options and `run`, so the server overview (PG-72) and agents open the same form.

### Consequences

* Good, because a statement that must run outside a transaction block always does
* Good, because the person sees the lock, the size and the wait before and while it runs
* Good, because a cancel stops the wait on the server, and only this run
* Bad, because VERBOSE output arrives at the end, not as the server writes it
* Bad, because a cancel that lands between two tables of a schema's VACUUM leaves the tables before
  it done; the statistics after show which

### Confirmation

`plugins/database/tests/maintenance-sql.test.ts` (the statements per version, the options, the lock
words), `maintenance.test.ts` and `maintenance-run.test.ts` (the guards, one statement per run, the
progress read and the cancel), `maintenance-live.test.ts` on a real PostgreSQL (every operation with
and without options outside a transaction block, a VACUUM FULL waiting behind another session's lock
and cancelled, a read-only connection refusing).

## More Information

`plugins/database/ui/features/maintenance/` (`sql.js` the statements and reads, `locks.js` the words,
`runs.js` the run, progress and cancel), `plugins/database/plugin.json`. Builds on ADR 0038 (one client
run per statement), ADR 0088 (agents' tools), ADR 0290 (the activity view's signals) and the feature
host (#506).
