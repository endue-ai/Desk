---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# A server session is cancelled or ended only after a yes

## Context and Problem Statement

PG-71 (#487) shows a PostgreSQL connection's sessions and locks in `endue.database` and lets the
person cancel a session's statement (`pg_cancel_backend`) or end the session
(`pg_terminate_backend`). Both are plain `SELECT`s, so the plugin's statement classifier reads them as
reads: a read-only connection would run them, production would not ask, and an agent's call would not
wait for the person. Yet ending a session rolls back someone's open transaction, on any connection to
that server, and cannot be undone. Which guards apply, and who can call them?

## Decision Drivers

* A read-only connection never changes the server, and a signal to another session is a change
* What will be stopped is visible before it is stopped: the session's statement, who runs it
* Production says so first, as a write on it does
* An agent never stops a session without the person's yes
* A role without `pg_signal_backend` is told the server's own refusal, not a guess
* PostgreSQL 13 and later: `pg_locks.waitstart` and `pg_terminate_backend(pid, timeout)` are 14's

## Considered Options

* The feature guards the two signals itself and asks every time, whoever asks
* Teach the classifier that `pg_cancel_backend` and `pg_terminate_backend` write
* Separate agent-only commands that ask, beside the person's that do not

## Decision Outcome

Chosen option: "the feature guards the two signals itself and asks every time", because the
classifier cannot know what a function call does in general (any function may write), and the
signals are the feature's own statements, built from a process id it validated.

* A read-only connection shows the panel and refuses both, in the panel, the palette and an agent's
  call, before anything is read or asked.
* Every cancel and end is asked first (`deps.confirm`), whatever the `confirm` setting: the title names
  the session and the connection, then come production's line when the connection is tagged so, the
  statement in one line (or that it is hidden from this role), who runs it and in which state, and what
  will happen. No is a quiet cancel.
* The panel, the palette and agents share the commands `endue.database.cancel-session` and
  `endue.database.end-session`; the manifest marks both `agent` and `irreversible` (ADR 0088), so an
  agent's call also waits for the core's approval before the plugin asks.
* The session is read again before the question, so it shows what runs now; a session gone since says
  so, and a session with no statement running (idle, idle in transaction) is not cancelled: only ending
  it rolls its transaction back.
* The server's error is said as it came: its message, then its detail (`Not cancelled: permission
  denied to cancel query. Only roles with the SUPERUSER attribute may cancel queries of roles with
  the SUPERUSER attribute.`, PostgreSQL 17). A session the server no longer has is said from its
  warning (`Not ended: PID 4242 is not a PostgreSQL backend process.`).
* An end waits up to 5 seconds for the session to exit on PostgreSQL 14 and later
  (`pg_terminate_backend(pid, 5000)`); on 13 it returns at once. Servers older than 13 are refused.

### Consequences

* Good, because read-only means read-only for the server's sessions too, whatever the SQL looks like
* Good, because the person sees the statement they stop, and an agent cannot skip them
* Good, because the server stays the judge of privileges: the plugin never guesses them
* Bad, because the palette asks every time, even for a session the person just selected and pressed
  `c` on; a stop is rare and costly enough to accept it
* Bad, because a console statement `SELECT pg_terminate_backend(...)` typed by the person still goes
  through the classifier as a read: the guard covers the feature's own statements only

### Confirmation

`plugins/database/tests/activity.test.ts` (the question, production, read-only, the refusal, an idle
session), `activity-live.test.ts` on a real PostgreSQL (a session in `pg_sleep` holding a row another
waits for: cancelled, then ended; a role without privileges refused in the server's words).

## More Information

`plugins/database/ui/features/activity/` (`signal.js` holds the guards, `sql.js` the statements per
version), `plugins/database/plugin.json`. Builds on ADR 0038 (one client run per statement), ADR 0088
(agents' tools) and the feature host (#506); ADR 0281's core session would carry the same statements.
