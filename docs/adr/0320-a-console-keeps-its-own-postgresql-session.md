---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# A console keeps its own PostgreSQL session

## Context and Problem Statement

Since PG-01 (ADR 0281) `endue.database` runs PostgreSQL on the core's sessions, but each run opened a
session and closed it, as one psql process was one run. A BEGIN in one run and a COMMIT in the next
meant nothing, a SET or a temporary table was gone at the next run, and a failed transaction could
not be seen. PG-02 (#442) keeps a session between runs. Which runs share a session, what the person
is shown, when a session closes, what happens when the server ends one, and how does the plugin stay
under the core's 16 sessions a caller?

## Decision Drivers

* What one run of a console sets, the next run of that console sees; nothing leaks into another
* The person always sees the session's state, from the server's own ReadyForQuery status
* Nothing that ends an open transaction happens without the person knowing first
* A session the server ended is said in words, and nothing is replayed on the new one
* Stay under the core's cap of 16 sessions a caller, with a clear message at a limit

## Considered Options

* A session per console and per table view; everything else short (chosen)
* One session per connection, shared by its consoles, table views, features and agents
* A session per console only; table views, features and agents short

## Decision Outcome

Chosen option: "a session per console and per table view; everything else short", because a shared
session lets one console's open transaction or failed state, SET or lock reach every other run on the
connection, and the explorer's reads would wait behind a person's long statement.

* **Owners.** A console's session is kept under its own id (ADR 0286), so it follows the console when
  the frame sleeps and wakes (ADR 0134); a table view's under its buffer. It opens at the owner's first
  run (read-only for a read-only connection) and runs one run at a time.
* **Short sessions.** The catalog, the schema cache, counts, the server's version, the features' reads
  and the grid's edits open a session and close it, as before. Edits do not join a console's open
  transaction; PG-20 decides that. An agent's `endue.database.query` runs on a short session of its own:
  an agent never steers a console's transaction or sees its uncommitted rows, and the run commands
  that act on a console take no SQL. What a feature runs in a console (a file run, a routine called
  from its form, PG-56) runs on that console's session, an agent's request too once the person said
  yes, since its result is shown there. Every session signs in alike: the typed password, else the
  one the keychain keeps by name (`passwordRef`, ADR 0311), else the password file.
* **State.** The header shows not connected, idle, running, in a transaction, in a failed transaction
  (saying ROLLBACK is needed) or session lost, in words and then a status dot, from each page's
  `transaction`. In a transaction and Dry run inside an open transaction run under `SAVEPOINT
  endue_desk`, so they never end the person's transaction; in a failed one they are refused.
* **Closing.** Closing the console, Disconnect, a change to how the connection signs in (engine, host,
  port, database, user, TLS mode, CA file, read-only) and removing it close the session, asked first
  while a transaction is open, saying it will roll back. A buffer the desk closes says so afterwards.
  A woken frame takes back the sessions `db.list` still holds for its consoles and closes the rest.
* **Lost.** `db.closed`, or a run that finds its session gone, makes the state "Session lost" with the
  reason and whether a transaction rolled back, on the status line too. The next run opens a new
  session and its messages say that SET, temporary tables and prepared statements are gone; nothing
  is run again.
* **Limits.** Kept sessions are at most `sessions-per-connection` a connection (8 by default, 1 to 12)
  and 12 for the plugin, so 4 of the core's 16 stay for short runs, which take at most 12 at once and
  wait for a slot. At a limit the least recently used idle table view's session closes first; past
  that, the run says which limit it met and what to close.
* **Idle.** A session no run used for `session-idle-minutes` (30, 0 keeps them) closes, never one in a
  transaction. No keepalive statement is sent: the core's TCP keepalive keeps the connection alive.
* **Cancel.** It stops the statement of the buffer on screen and the plugin's own short reads; other
  consoles and agents' runs go on. A run's own signal (PG-81) stops that run alone: `db.cancel` on its
  session, a kept session left open with its transaction (failed after a cancel inside one), a short
  one closed as its run ends. Neither closes a kept session.
* A changed statement timeout reaches a kept session as `SET statement_timeout` before its next run
  outside a transaction.

### Consequences

* Good, because a console behaves as a psql session the person keeps open: transactions, SET,
  temporary tables and prepared statements last, and its state is always on screen.
* Good, because one console's lock or failed transaction never blocks or fails another buffer's runs.
* Bad, because a connection can hold up to 8 server connections for one person, which counts against
  the server's `max_connections`; the limit and the idle minutes are the person's to lower.
* Bad, because a grid edit made while the console's transaction is open runs outside it (PG-20).
* Bad, because a session the core lost while the frame slept is only found at the next run.

## More Information

Issue #442 (PG-02, epic #438); the core's sessions are ADR 0281, consoles ADR 0286. Modules:
`plugins/database/ui/session/` and `ui/engines/pg-session.js`, `ui/engines/pg-script.js`; the feature
notes are in `plugins/database/docs/sessions.md`. No section of
`docs/ko/desk-structure.md` changes: the plugin's use of `db.*` stays inside ADR 0281's contract.
