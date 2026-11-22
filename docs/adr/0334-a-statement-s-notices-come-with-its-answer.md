---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# A statement's notices come with its answer

## Context and Problem Statement

Since ADR 0281 the core sends every notice a PostgreSQL session hears as a `db.notice` event, while
`db.run`, `db.fetch` and `db.copy` answer on the call's own channel. Events and answers reach a
plugin's frame on separate paths, so a notice raised by a statement could arrive after its answer:
the database plugin then put it on the next statement, or lost it when it was the last statement's
(a maintenance run's VERBOSE output, a routine's RAISE NOTICE). How does a notice stay with the
statement that raised it, whatever order the frame hears things in?

## Decision Drivers

* A notice is shown with the statement that raised it, every time, not most of the time
* A notice raised outside any call (at sign-in, while idle) is still shown, as the session's own
* Nothing shows twice, and no answer grows without bound
* The smallest change to the bridge's contract (v0, additive where it can be)

## Considered Options

* The answer carries the notices raised while its call ran (chosen)
* Each `db.notice` event carries the id of the run it belongs to
* Keep events alone, and have the plugin wait a moment after each answer for late notices

## Decision Outcome

Chosen option: "the answer carries the notices", because the session's task reads a call's notices
on the same connection, in the same order, before it answers that call. Putting them in the page
makes their order with the statement a fact of the protocol, needs no new id on the wire, and keeps
the plugin's pairing to one line per page.

* `DbPage.notices`: the notices the server sent while that call ran, in order, every field by name.
  A statement's are spread over the pages of its `db.run`, `db.fetch` and `db.copy` as they were
  raised. A notice in a page is never also a `db.notice` event.
* A page keeps at most 10,000 notices; `noticesSkipped` counts the rest, and the plugin says how many
  were left out.
* `db.notice` is now for a notice outside any call: those that came with the sign-in, or one the
  server sends while the session is idle. A call that fails as a bridge error (the session gone)
  sends the notices it heard as events first, so none is lost.
* The plugin shows a statement's notices from its pages; those of its own statements (BEGIN, COMMIT,
  savepoints, a deferred trigger's at COMMIT) and a session's `db.notice` events are the run's own
  lines, on the run going on, else on the next run of that kept session.

### Consequences

* Good, because the pairing no longer depends on timing: the last statement of a script and a COMMIT
  keep their notices, and a late event can no longer move one onto the next statement.
* Good, because the plugin no longer needs to keep a per-statement listener for events.
* Bad, because a statement's notices reach the frame with its page, not as each is raised; nothing
  showed them live before (the runner handed them over at the end), so nothing is lost today.
* Bad, because a caller that read a run's notices from `db.notice` must read them from the page now.

### Confirmation

`crates/desk-pg/tests/live_notices.rs` and `crates/desk-core/tests/db_live.rs` check that a run's
notices come in its page and not as events; `plugins/database/tests/notice-order.test.ts` delivers a
notice after its answer on a scripted session; `notice-live.test.ts` runs RAISE NOTICE in a script's
last statement, a deferred trigger at COMMIT and a routine from its form against a real server.

## Pros and Cons of the Options

### The answer carries the notices

* Good, because the order is the protocol's, read on one task.
* Neutral, because it adds two optional fields to `DbPage`.

### A run id on each event

* Good, because notices still arrive as they are raised.
* Bad, because the core would invent run ids that `db.run` does not have, and the plugin would still
  have to wait for events it cannot know are complete when the answer comes.

### Wait after each answer

* Bad, because no wait is long enough under load, and every run gets slower.
