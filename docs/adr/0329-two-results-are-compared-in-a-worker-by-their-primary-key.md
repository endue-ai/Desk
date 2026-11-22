---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# Two results are compared in a worker, by their primary key, and the difference is a result

## Context and Problem Statement

PG-26 (#459) asks that `endue.database` keep a result tab through later runs (pinned, under a memory limit)
and compare two results: the rows added, removed and changed, by a key the person picks (the primary key
when it is known), the changed cells within a row, the columns only one side has; the difference copied and
exported in the plugin's formats; and run again and compare as one command. Results reach 100,000 rows, and
the page's main thread must stay free (#38). Where does a comparison run and how large may it be, how are rows
paired, and what shape does the difference take when it leaves the plugin as a file?

## Decision Drivers

* Pairing two large results never holds the frame's thread, and nothing unbounded comes back to it
* The person always knows what the rows were paired by, and why
* A difference written to a file reads back in the tools that read the plugin's other exports
* Pinned results cannot grow the frame's memory without a bound

## Considered Options

* Compare in a worker of the plugin, bounded in what it takes and what it keeps
* Compare on the main thread, in slices between frames
* Compare on the server (`EXCEPT` of the two queries)

## Decision Outcome

Chosen option: "in a worker, bounded", because it keeps the frame free whatever the sizes, needs no second
run of either query, and works on any two results, a pinned snapshot included, which the server no longer
has.

* A comparison past 20,000 cells (both results together) runs in a worker started for it and let go when it
  answers (`ui/compare/worker.js`); smaller ones run in place, where a worker costs more. It takes at most
  2,000,000 cells a side and refuses past that with how to narrow the queries. It answers exact counts and the
  first 2,000 differences with their values, so what returns to the frame is bounded.
* Rows pair by the primary key when both results carry the same one: the catalog's, for the one table a plain
  SELECT or a table view reads (as editing finds it), kept with a pin. Otherwise by row position. Compare asks,
  the primary key first, then position, then any shared column; run again and compare takes the primary key,
  else position, without asking. The panel and the status line say which, and why when it is position. A
  repeated key pairs its rows in order and is counted.
* Columns pair by name, a repeated name by its occurrence; a column only one side has is listed and not
  compared. Cells compare as the text the server sent; NULL differs from every text, `''` included.
* The difference is a result of its own: a column `change` (`added`, `removed`, `changed (before)`,
  `changed (after)`, renamed `_change` when a result has a `change`), then the shared columns, then the
  one-side ones; every format of the plugin writes it as it writes any result.
* Pinned results of all consoles keep under 64 MiB (estimated: two bytes a character and a cell's and a
  row's overhead); a new pin lets go of the oldest first and says so; one past the limit alone is refused.

### Consequences

* Good, because the frame stays responsive while 100,000 rows are paired, and a refusal says why and how.
* Good, because a difference file is a plain table any reader of CSV or JSON takes.
* Bad, because two results of 2,000,000 cells are copied to the worker once (structured clone), a cost the
  frame pays while it posts them.
* Bad, because a difference past 1,000 rows is listed, copied and exported only in part; the counts stay
  exact and the panel says so.

### Confirmation

`plugins/database/tests/compare-diff.test.ts`, `compare-worker.test.ts`, `compare-pins.test.ts`,
`compare-feature.test.ts`, `compare-panel.test.ts`, and against a real PostgreSQL `compare-live.test.ts`.

## Pros and Cons of the Options

### In a worker, bounded

* Good, because nothing pairs on the frame's thread, and the answer is bounded.
* Bad, because the results are copied to the worker.

### On the main thread, in slices

* Good, because nothing is copied.
* Bad, because the key index of both results still lives on the frame, and a long comparison competes with
  every frame drawn.

### On the server

* Good, because the server does the work.
* Bad, because it runs both queries again, cannot compare a pinned snapshot with now, and does not name the
  changed cells.
