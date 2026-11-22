---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# A console's read scrolls through a cursor on its session

## Context and Problem Statement

A PostgreSQL console's result kept at most `max-rows` rows (500 by default, 100,000 at most); More rows
ran the statement again with four times the limit, and a console's single SELECT paged by running it
again with LIMIT and OFFSET. A read of ten million rows could not be scrolled to its end, and each page
cost the statement's whole work again. Since ADR 0281 the plugin runs PostgreSQL on the core's sessions,
and since ADR 0320 a console keeps its own: how do the rows of one read come to the grid as the person
scrolls, read once, with the frame's memory bounded?

## Decision Drivers

* The statement runs once: scrolling never runs it again
* The frame holds a bounded number of rows; rows let go can be read again
* What the console's session holds for the person (a transaction, PG-20's manual commit) keeps its meaning
* No change to the core's contract, so the lanes beside it stay independent
* Scripted tests and the fixture page answer the same statements the server sees

## Considered Options

* A scroll cursor on the console's kept session, declared by SQL (chosen)
* The protocol's unnamed portal, kept suspended between `db.fetch` calls
* The unnamed portal, with the pages let go kept on disk by the plugin
* Run again with LIMIT and OFFSET per page (as before)

## Decision Outcome

Chosen option: "A scroll cursor on the console's kept session", because it is the only one that reads
once and still fetches rows let go again: `DECLARE endue_desk_rows SCROLL CURSOR FOR <read>` is planned
for a fast start, the server computes rows only as they are fetched and keeps what a backward scan needs,
and `MOVE ABSOLUTE` + `FETCH FORWARD` read any page. It needs nothing new from the core (`db.run` and
`db.script`), and the browser stub learns cursors so scripted tests see the read itself.

A cursor lives in a transaction. Outside one the plugin opens its own (`START TRANSACTION`, ended by
`END`, rolled back by `ABORT`: words a person's script does not use, so readers of a session's statements
tell them apart) and hides it from the header; inside the person's the cursor is theirs. Either way the
cursor ends before the console's next run, at a cancel or an error during a fetch, and with the session.

### Consequences

* Good, because a result of any size opens at once and scrolls to its end; a test scrolls a million rows
  with at most four pages held.
* Good, because the console's next run, COMMIT and ROLLBACK keep their meaning: the cursor ends first.
* Bad, because while a large read is held its transaction keeps a snapshot open on the server, which holds
  back vacuum, until the console runs again or closes. The summary says the result is still being read.
* Bad, because only a single read qualifies (`DECLARE` takes `SELECT`, `VALUES` and `TABLE`, not `FOR
  UPDATE` or `INTO`), and sorting or filtering a result not fully read runs the statement again with
  ORDER BY and WHERE around it.
* Bad, because the server's own views name what runs as the cursor's statements: while a page is read,
  `pg_stat_activity.query` of the console's session reads `FETCH FORWARD ... FROM endue_desk_rows`,
  not the read as typed.
* Bad, because a SCROLL cursor over a plan that cannot run backwards makes the server materialize the rows
  read so far (in work_mem, then temporary files).

### Confirmation

`plugins/database/tests/rows-cursor.test.ts`, `rows-window.test.ts`, `rows-shape.test.ts` and
`packages/bridge/src/stub-db-cursor.test.ts` on the stub; `rows-live.test.ts` on a real server through the
core; `packages/runtime/e2e/database-rows.spec.ts` in the runtime page.

## Pros and Cons of the Options

### The protocol's unnamed portal

* Good, because the core already keeps it suspended between `db.fetch` calls, with no transaction words.
* Bad, because a portal reads forward only: rows let go could never be fetched again without running the
  statement again, so memory is bounded only by giving up scrolling back.

### The portal, with pages let go kept on disk

* Good, because it reads once and scrolls both ways.
* Bad, because rows of a production database would land in files on the person's disk, and the frame's
  storage is not known to hold in every place the desk runs.

### LIMIT and OFFSET per page

* Good, because it needs no state on the server.
* Bad, because each page runs the statement again (a sort or a join each time), OFFSET reads every row
  before the page, and rows move between pages when the data changes.
