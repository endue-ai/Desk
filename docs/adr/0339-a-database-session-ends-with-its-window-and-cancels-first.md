---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# A database session ends with its window, and ending one cancels its statement first

## Context and Problem Statement

ADR 0281 gives a `db.*` session to the plugin that opened it: it ends at `db.close`, when the server
or the network ends it, when the plugin stops and when its grant goes. A check of the real app found
three ways a session outlived what opened it. Closing the Database window while a statement ran left
the plugin enabled, so the core kept the session: the statement ran to its end and the session then
sat idle on the server, one of the plugin's sixteen, until the plugin stopped. Closing a session sent
Terminate only, and a PostgreSQL backend reads nothing while a statement runs, so `db.close`, an
unload and the desk's quit all left the statement running for its whole length. And after
Disconnect, the activity panel's period kept opening sessions, signing in again through the password
file. Who ends a session when its page goes, and how does an end stop what runs?

## Decision Drivers

* No session or statement stays on a server after what opened it is gone
* A frame that only sleeps (ADR 0134) or reloads keeps its consoles' transactions (ADR 0320)
* The core knows plugins, not windows; the runtime knows windows (ADR 0212)
* An end is bounded in time, also at quit
* No new bridge method or field

## Considered Options

* The runtime closes a window's sessions; every end cancels a running statement first (chosen)
* `db.open` carries the window's key and the core ends a page's sessions on a new call
* Sessions end whenever a frame unloads, sleep included

## Decision Outcome

Chosen option: "the runtime closes a window's sessions; every end cancels first", because the
runtime already routes each session's events to the window whose `db.open` started it, so it knows
which sessions a window holds, and the existing `db.close` is enough for it to end them.

* **A window's sessions.** When a plugin's window closes (ADR 0212; its first window too), the runtime
  calls `db.close` as its plugin for each session that window opened and has not seen end. A session
  whose `db.open` answers after its window closed is closed at once. A window whose frame sleeps
  (ADR 0134) or reloads keeps its sessions: its next page takes back its consoles' with `db.list`
  and closes the rest (ADR 0320).
* **Ending cancels first.** A session told to end while the server may still be executing for it (a
  call waiting on its answer, a COPY out it streams, rows it still sends past a page) sends a cancel
  request first (2 s at most), then Terminate (2 s at most). This holds for `db.close`, an unloaded
  plugin, a revoked grant and the quit alike. An idle session sends Terminate only.
* **Quit.** After the shell's pages close, `Core::quit_databases` ends every caller's sessions
  (`desk`) and waits at most 5 s for them to be gone. The live tests' bridge does the same when its
  standard input ends.
* **Disconnect.** The plugin marks a disconnected connection in memory and stops every run in flight
  on it, kept or short. A read the plugin starts on its own (the activity panel's period, a
  maintenance run's progress and its statistics after) is refused on it with a sentence and opens no
  session; any other run, the person's or an agent's, connects it again.

### Consequences

* Good, because closing a window, stopping a plugin and quitting leave nothing running on a server.
* Good, because the bridge's contract is unchanged; a plugin that never closes its sessions is
  covered by the window that holds them.
* Bad, because a statement whose window closes is cancelled, not left to finish: a long write the
  person started rolls back with it (asked about only while a transaction is open, as before).
* Bad, because a window whose runtime page itself reloads (in development) leaves its sessions to the
  plugin's unload or the quit.
* Bad, because a quit can take up to 5 s longer when a server does not answer the cancel.

### Confirmation

`crates/desk-pg/tests/live_close.rs` closes a session during `pg_sleep(30)` and finds no backend of
it; `crates/desk-core/tests/db_end_live.rs` does the same for `db.close`, an unloaded plugin and
`quit_databases`; `packages/runtime/src/plugins-db.test.ts` checks which sessions a closing,
sleeping or late window closes; `plugins/database/tests/session-lifetime-live.test.ts` checks
Disconnect during a console's statement and a quitting core on a real server, and
`disconnect-timers.test.ts` the activity panel after Disconnect.

## Pros and Cons of the Options

### The runtime closes a window's sessions

* Good, because the runtime already holds the session-to-window map for routing events.
* Bad, because a runtime page that reloads loses the map; the plugin's unload or the quit still ends
  the sessions.

### The window's key on db.open

* Good, because the core could end a page's sessions itself.
* Bad, because it adds a field the runtime must fill on every `db.open` and a call to say a page
  went, for what `db.close` already does.

### End on every unload

* Good, because it is the simplest rule.
* Bad, because a console's open transaction would roll back whenever its window falls out of the
  live set (ADR 0134).

## More Information

Issue #562 (PG-01f), plan #438; ADR 0281 (db.*), ADR 0320 (a session per console), ADR 0134 (frames
that sleep), ADR 0212 (several windows of a plugin).
