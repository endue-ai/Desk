---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# A PostgreSQL password comes from a command the person allowed, and a pooler gets no session state

## Context and Problem Statement

Managed PostgreSQL servers often take short-lived passwords: a token a command-line program prints,
valid for minutes. Other servers sit behind a connection pooler in transaction mode, which lends a
server connection for one transaction at a time and refuses or drops startup parameters it does not
know. The database plugin signs every session in with a typed or kept password (ADR 0311) and its
own startup parameters (statement timeout, ISO dates, read-only default, the session options of
PG-12). How does a session get a password from a program without widening what the plugin may run,
and what must the plugin stop relying on behind a pooler (#451)?

## Decision Drivers

* No new permission and no new named program in the manifest (`tests/manifest.test.ts` pins them)
* A program named in a connection runs only once the person has seen that exact command for it
* The password is fetched for each new session and never kept, logged or shown
* An expired password is fetched once more without the person typing anything
* Behind a pooler, nothing the plugin does may depend on state kept between transactions, and what
  cannot work is refused in words before anything is sent

## Considered Options

* A per-connection command, run under the existing `proc:spawn` on `*` after the person's yes to that
  command for that connection, kept by the plugin; the password used for one sign-in
* As the first, without the plugin's own yes: rely on the desk's ask for the program by name
* A new named program in the manifest (a fixed helper the desk ships) or a new permission kind
* The core runs the command itself inside `db.open`

and, for poolers:

* A connection choice "through a pooler" that drops the plugin's startup parameters, takes no `SET`,
  refuses statements that keep session state, and refuses session options on such a connection
* Detect a pooler from the server's answers and adapt
* Leave it to the person (no option), documenting what breaks

## Decision Outcome

Chosen options: "a per-connection command after the person's yes" and "a connection choice through
a pooler".

**The command.** `passwordCommand` is one line, split on spaces with double quotes (no shell, no
expansion), a program by name or full path; the five programs the manifest grants by name are
refused, so a command always reaches the desk's ask. The desk's grant is per program, so on its own it
would let a second connection, or a command that arrived in the store another way, run the same
program with other arguments unseen: the plugin therefore asks in the palette for that command on that
connection before its first run and keeps the yes (`password-commands` in its store: connection id to
command, never output). The program runs by `proc.spawn` under `proc:spawn` on `*`, which already lets
the plugin ask for a program a setting names (ADR 0260). Its first line is the password, handed to
the one `db.open` and dropped. A refusal with SQLSTATE `28P01` or `28000` runs it once more and tries
again; a second refusal, or a failing command (its exit and the first line of its standard error), ends
the run in words and opens no password prompt. A command and the keychain are exclusive. The
connections file and a URI never carry a command.

A fixed helper or a new permission would need the manifest and the core to grow for every vendor's
program; the core running the command would put process spawning inside a database call and outside
the plugin's ask. Relying on the desk's ask alone leaves the per-program hole above.

**The pooler.** `pooler: true` signs in with `application_name` alone; the statement timeout falls to
the plugin's own stop (cancel, then close, past the timeout and five seconds) and read-only to the
plugin's guard. A kept session takes no `SET statement_timeout`. Session options and a startup script
are refused on such a connection. A run is refused in words when a statement keeps session state: `SET`
outside `LOCAL`/`TRANSACTION`/`CONSTRAINTS`, `RESET`, `LISTEN`/`UNLISTEN`, `PREPARE`, `EXECUTE`,
`DEALLOCATE`, `DECLARE … WITH HOLD`, a temporary table without `ON COMMIT DROP`, `DISCARD`, `LOAD`, a
session advisory lock. Reads, pages (the core keeps a statement's portal before its Sync and prepares
only unnamed statements), edits, explicit transactions, `SET LOCAL` and the catalog keep working.
Detecting a pooler is unreliable (it answers as the server does); leaving it to the person means the
first run fails on a startup parameter.

### Consequences

* Good, because no permission or named program is added, and a command never runs unseen.
* Good, because a pooled connection fails in words, not on a later transaction's missing state.
* Bad, because the person answers two asks before a command's first run (the plugin's for the
  command, the desk's for the program); later sessions ask nothing.
* Bad, because behind a pooler the server enforces neither the statement timeout nor read-only;
  the plugin does, a few seconds later for the timeout.
* Neutral, because maintenance and the audit check, which run `SET` and `PREPARE`, are refused on
  a pooled connection until they run in a transaction of their own.

### Confirmation

`plugins/database/tests/password-command*.test.ts`, `pooler.test.ts`, the live test against a real
server (and a pooler when `ENDUE_DB_TEST_POOLER` names one) and
`packages/runtime/e2e/database-password-command.spec.ts`.
