---
status: accepted
date: 2026-11-23
decision-makers: Team endue
---

# A call's notices arrive as they are raised, and a console listens

## Context and Problem Statement

Since ADR 0334 a statement's notices come with its answer: a long routine's RAISE NOTICE progress
shows only when it ends. A console's session is kept between runs (ADR 0320), so `LISTEN` could now
hear notifications while the console is idle, and the core already sends them as `db.notification`;
but the plugin showed none, and a lost session (ADR 0355) or a reconnect said nothing of what it
listened to. How do notices show while a statement runs without losing ADR 0334's pairing, and how
does a console listen without anything listening on someone's behalf?

## Decision Drivers

* A notice is still shown with the statement that raised it, every time (ADR 0334)
* Progress is seen as it is raised, in order, with its severity and context
* Notifications arrive while idle and in bursts: the page must not stall or grow without bound
* Nothing runs again, or listens, without the person (ADR 0355), and never for an agent
* The bridge changes additively (v0)

## Considered Options

* A new event, `db.call.notice`, for each notice a call hears, and a call number on the page (chosen)
* A `call` field on `db.notice`
* Polling the session for notices while a call runs

## Decision Outcome

Chosen option: "a new event and a call number", because the page stays the record and the event only
shows progress. The core's session task already reads each notice on the call's connection before it
answers the call; it now also sends it to the caller as it arrives.

* `db.call.notice` carries `sessionId`, `call` and the notice, for each notice a page keeps (at most
  10,000 a page). `DbPage.call` is the session's number for the call the page answers, from 1, the
  same on every page of a `db.script`. An event whose call is already answered is late and is dropped.
* The plugin shows a running console's notices in the run's Messages tab as they come, in arrival
  order, its latest 2,000 lines; at the run's end the tab is the record, each notice on its statement
  (ADR 0334). Notices reach consoles this way; a short session's still come with its answer.
* A console's Notifications tab is a result of what its session heard after LISTEN: when, channel,
  payload and the sender's process id. It keeps the latest 1,000 and says how many it dropped, shows
  a badge of the unseen ones until it is on screen, and is cleared and exported as a result is. What
  is heard draws at most once in 100 ms.
* The channels a console listens to are read from the statements it ran (LISTEN, UNLISTEN, UNLISTEN *,
  DISCARD ALL), applied at COMMIT inside a transaction and dropped at ROLLBACK, in a failed transaction
  and in a dry run. The plugin runs no query of its own to learn them.
* A listening session is never closed for idleness. A session that ends, lost or closed, says it
  stopped listening on its channels. A reconnect, on its own or the person's, does not LISTEN again:
  Listen again, on the tab and as a command, runs LISTEN in the console as the person's run.
* An agent's run that holds LISTEN or UNLISTEN does not run. A connection through a pooler keeps
  refusing LISTEN (ADR 0354): the pooler lends the server connection to other clients between
  transactions, so a notification would reach whoever holds it then, and the console would hear none.

### Consequences

* Good, because a long routine's progress shows as it runs, and its notices still land on their
  statement in the record.
* Good, because LISTEN works in a console, and a burst of notifications costs a bounded list and ten
  draws a second.
* Bad, because a live line is not tied to its statement inside a `db.script` batch until the run ends.
* Bad, because a LISTEN inside a function is not seen as a channel (its notifications still show), and
  the channels are not known again after the frame wakes.
* Bad, because each kept notice now crosses the bridge twice: as an event and in its page.

### Confirmation

`crates/desk-pg/tests/live_raised.rs` and `crates/desk-core/tests/db_live_raised.rs` check that the
events arrive before the answer, in order, with the page's call; `packages/bridge/src/stub-db-listen.test.ts`
the stub's LISTEN and NOTIFY; `plugins/database/tests/listen-*.test.ts` and `notice-raised.test.ts`
the plugin, on the scripted server and against a real one through the core;
`packages/runtime/e2e/database-listen.spec.ts` the tab in the runtime page.

## Pros and Cons of the Options

### A new event and a call number

* Good, because callers that read `db.notice` as the session's own keep working.
* Neutral, because it adds an event and an optional field to `DbPage`.

### A call field on db.notice

* Good, because there is one notice event.
* Bad, because ADR 0334 promised a notice in a page is never also a `db.notice`, and a caller that
  trusts it would show it twice.

### Polling while a call runs

* Bad, because the session answers one call at a time: nothing could ask it while the statement runs.
