---
status: accepted
date: 2026-11-23
decision-makers: Team endue
---

# A whole export streams COPY in one snapshot to a temporary name

## Context and Problem Statement

The database plugin's export writes the rows a result holds, 100,000 at most (PG-61). Exporting a table of
ten million rows has to read every row without the grid, keep the frame's memory flat, write any of the
plugin's ten formats, show progress, leave no partial file when cancelled, and take several tables to a
folder as one consistent picture. Where do the rows come from, how are formats other than the server's own
written from them, and how does a cancel leave nothing behind when the bridge has no delete?

## Decision Drivers

* Memory bounded by a page whatever the row count; heavy work off the frame's thread
* The file the person chose is either complete or untouched
* One snapshot for every file of an export, and nothing it runs can write
* No new bridge method and no new dependency

## Considered Options

* `COPY (<query>) TO STDOUT` for every format: the server's bytes when they are the file, else its text
  format read back and rewritten by the plugin's writers (chosen)
* A cursor (`DECLARE` and `FETCH`) read in pages, as the grid scrolls (PG-22)
* `COPY` only for CSV and TSV, and the other formats refused past the rows held

## Decision Outcome

Chosen option: "`COPY` for every format", because one stream serves all ten formats with the server doing the
fastest part, its pages already move in bounded chunks through the session (ADR 0356), and the text format
reads back exactly (NULL apart, every escape decoded).

* CSV and TSV whose options are the server's output (`copy/direct.js`) go to the file as the server wrote them;
  anything else reads the text format (`copy/text.js`) and writes through the result export's writers in
  pieces (`export/stream.js`), so the bytes equal what that export writes for the same rows. An `.xlsx` streams
  its sheet as a deflated zip entry with a data descriptor (`export/zip-stream.js`).
* Each file's pages become bytes in a worker of its own (`export/pipe-worker.js`); gzip is the platform's
  `CompressionStream`.
* The export runs on a session of its own in `START TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`,
  ended by `ROLLBACK`.
* The bytes go to `.<name>.partial` beside the chosen file (fs.write, then `append`) and `fs.rename` gives it
  the chosen name at the end. `fs.rename` never overwrites, so a file already there goes to the OS trash just
  before; a cancel or a failure moves the temporary file to the trash.

### Consequences

* Good, because the chosen path never holds a partial file, and the rename never crosses a volume.
* Good, because every format reads the same rows the same way, and CSV and TSV cost the frame only a copy.
* Bad, because the temporary name beside the file is outside the save dialog's grant, so the plugin asks for
  it once per export (a folder export asks once for the folder).
* Bad, because a cancelled file lands in the OS trash rather than being deleted: the bridge has no delete for
  good, and adding one is a change to the contract left for later.
* Bad, because JSON decides numbers by the column's type, where the result's export looks at the values.

### Confirmation

`plugins/database/tests/export-all-text.test.ts` reads the text format cut anywhere and checks every text
format in pieces against the result's export; `export-all-xlsx.test.ts` and `export-all-gzip.test.ts` read the
streamed workbook and the gzip back; `export-all-feature.test.ts` checks the transaction, the temporary name and
the rename, Cancel and a folder; `export-all-live.test.ts` exports ten million rows from a real server through
the core both ways with the heap measured and the file's SHA-256 compared.

## Pros and Cons of the Options

### A cursor read in pages

* Good, because the grid already reads that way.
* Bad, because every value crosses the bridge as a JSON row and is formatted in the frame even for CSV, and a
  `FETCH` per page is a round trip COPY does not need.

### COPY only for CSV and TSV

* Good, because it is the least code.
* Bad, because eight of the ten formats would still stop at the rows held.
