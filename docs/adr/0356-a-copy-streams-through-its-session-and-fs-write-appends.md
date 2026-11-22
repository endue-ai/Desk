---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# A COPY streams through its session, and fs.write appends

## Context and Problem Statement

PostgreSQL's fastest way to move rows is `COPY ... TO STDOUT` and `COPY ... FROM STDIN`. The core's
sessions already speak COPY's sub-protocol (ADR 0281: `db.copy` sends chunks of 1 MiB at most, a COPY
out answers pages of `data` that `db.fetch` reads on), but the database plugin refused both, because
nothing could hand their rows to a file. A console's COPY has to go to or come from a file the person
picks, with progress and Cancel, and the plugin's import, copy between databases and table export
(PG-60, PG-63, PG-64) need the same stream. Reading a file in ranges is possible (`fs.read` `offset`
and `length`), but `fs.write` only replaces a whole file, so a COPY out of millions of rows would have
to be held whole before it is written. How do the rows reach a file in bounded memory, and where does
the stream live?

## Decision Drivers

* Neither side holds a file whole: memory stays bounded by one chunk, whatever the row count
* The file is the one the person chose in the desk's dialog, under that path's grant alone
* A cancel mid-way leaves the session ready for the next statement
* The guards hold: a read-only connection refuses COPY FROM, production asks, agents are refused
* An additive change to the bridge's contract (v0)

## Considered Options

* `fs.write` gains `append`; the plugin streams COPY pages and file ranges through the run (chosen)
* A new `fs.open` / `fs.append` / `fs.close` handle API
* A `db.copy` that reads or writes a path itself, in the core
* Hold the COPY out in the frame and write it once

## Decision Outcome

Chosen option: "`fs.write` gains `append`", because it is the smallest addition that makes a file
writable in chunks, and keeps the core's file rules (the scope, the grant, the agent's approval) on
every chunk with no new state in the core.

* `fs.write { ..., append: true }` adds the content at the end of the existing file in place: no temp
  file, no kept version, no undo entry, and a missing file is `not_found`. A file written in chunks
  takes an ordinary write first (which keeps what it replaces, ADR 0076) and appends after.
* The plugin's run carries a `copy` (`ui/copy/stream.js`): a sink for `COPY ... TO STDOUT`, whose pages
  of 1 MiB are written one at a time, or a source for `COPY ... FROM STDIN`, read in 1 MiB ranges as
  base64 and sent by `db.copy`. `engines/pg-script.js` hands the COPY's first page to the stream.
* A cancel closes a COPY out (the core cancels it on the server) and fails a COPY in with CopyFail;
  between two calls nothing runs on the session, so `db.cancel` alone would not reach it.
* The executor asks for the file once the guards passed (`ui/copy/console.js`: the save or the open
  dialog); `COPY ... TO STDOUT` is classed a read unless its query writes. A COPY through standard
  input or output runs alone, and never for an agent.
* `ui/copy/index.js` (`copyOut`, `copyIn`, `fileSink`, `fileSource`) is the call the plugin's other
  parts use, through `deps.execute`.

### Consequences

* Good, because 1,000,000 rows (97 MiB) went out and in again with the plugin's heap about 2 MiB above
  where it started (measured in the pull request), and the copy equal to the source.
* Good, because each chunk passes the same grant check, so a write never reaches past the chosen path.
* Bad, because an append is not atomic as a whole write is: a COPY out that fails or is cancelled
  leaves the rows it wrote, and the file's earlier content is kept only by the first write's version.
* Bad, because a chunk crosses the bridge as JSON (base64 for a file read), a third more bytes than
  the file's.

### Confirmation

`crates/desk-core/tests/fs_write_append.rs` and `packages/bridge/src/stub-append.test.ts` check the
append on the core and on the browser stub. `crates/desk-pg/tests/live_copy.rs` copies 1,000,000 rows
out and in on a real server in bounded pages and chunks. `plugins/database/tests/copy-*.test.ts` check
the classes, the guards, the stream, the console's dialogs and bar, and (`copy-live.test.ts`) 1,000,000
rows through the real core with the heap measured, a malformed line and a cancel both ways.

## Pros and Cons of the Options

### `fs.write` with `append`

* Good, because it is one optional field, and every other rule of `fs.write` still applies.
* Bad, because the caller orders its chunks; two writers appending to one file would interleave.

### A handle API

* Good, because a handle could write atomically at its close.
* Bad, because the core would keep open files per caller, with their lifetime, limits and cleanup.

### The core reads or writes the path in `db.copy`

* Good, because the rows would not cross the bridge at all.
* Bad, because `db.*` would take file paths and fs grants, two permissions in one call, and the
  plugin's other parts (a copy between databases) would still need the stream in the frame.

### Hold the COPY out whole

* Bad, because memory grows with the table: what the person runs COPY for is the large table.
