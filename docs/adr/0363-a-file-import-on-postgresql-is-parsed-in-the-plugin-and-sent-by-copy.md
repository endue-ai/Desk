---
status: accepted
date: 2026-11-23
decision-makers: Team endue
---

# A file import on PostgreSQL is parsed in the plugin and sent by COPY

## Context and Problem Statement

The database plugin's import (ADR 0119) reads a dropped `.csv`, `.tsv` or `.json` file whole, maps its
columns onto an existing table and runs INSERT statements in one transaction, 512 KiB of SQL at most. A
file of several gigabytes cannot be read whole in the frame, INSERT is far slower than COPY, and a
spreadsheet or JSON lines file is not read at all. The console's COPY (ADR 0356) streams a file the
person picks into `COPY ... FROM STDIN`, but only when the file already is in a format the server
reads, with no column mapping, no new table and no handling of a bad row. How does a file of any size
and of the common formats go into an existing table or a new one, in bounded memory, with a bad row
either stopping the import or set aside?

## Decision Drivers

* Memory stays bounded by one chunk, whatever the file's size
* The formats people have: CSV with any delimiter, quote and escape, PostgreSQL's text format, JSON
  (an array, or one value per line) and `.xlsx`
* A new table's columns and types come from the file, and the person corrects them before anything runs
* The guards hold: a read-only connection refuses, production asks, agents have no import
* No new contract between the plugin and the core

## Considered Options

* The plugin parses the file in a worker and sends COPY's text format through `ui/copy` (chosen)
* Send the file's bytes as they are with `COPY ... (FORMAT csv, DELIMITER ..., ENCODING ...)`
* A `db.import` in the core that reads the path itself
* Keep INSERT, in batches

## Decision Outcome

Chosen option: "The plugin parses the file in a worker and sends COPY's text format", because it reads
every format the same way (an `.xlsx` or JSON cannot go to the server as it is), it knows each row's
line and values, so a refused row can be named and written to a reject file, and it adds nothing to
the bridge: the file is read in 1 MiB ranges with `fs.read` and sent with `db.copy` (ADR 0356).

* `ui/import-copy/` reads the file incrementally (`csv.js`, `lines.js`, `transform.js`) in a worker of
  its own (`worker.js`, with the vendored spreadsheet reader of ADR 0043 copied to
  `ui/vendor/sheetjs/`), and hands the page COPY lines of 1 MiB at most (`source.js`).
* The wizard opens on the file's first 1 MiB; a new table's types are the narrowest the first 1,000
  rows read as (`infer.js`), and the person renames, retypes or leaves out any column.
* The import runs on a session of its own (`run.js`), kept for its run and closed after: BEGIN, `SET
  LOCAL DateStyle` for the date order, CREATE TABLE, COPY, COMMIT; with batches, COMMIT and BEGIN every
  N rows. A failure rolls back, keeping only the committed batches.
* Skip mode sends segments of 10,000 rows under a savepoint; a refused row is written with the server's
  reason to a CSV reject file the person chose, the savepoint rolled back and the segment sent again
  without it. Past 1,000 refused rows it stops.
* Check on the server copies the first 20 rows into a temporary table in a transaction that rolls back.
* An `.xlsx` is read whole (a ZIP), up to 64 MiB; a JSON array whole, up to 16 MiB. The other engines
  keep ADR 0119's INSERT import.

### Consequences

* Good, because a generated CSV of 2 GiB (32,537,630 rows) went in through the real core in one
  transaction with the plugin's heap at most 7.5 MiB above where it started, its row count and checksum
  equal on the server (`import-copy-live.test.ts`, measured in the pull request).
* Good, because a bad row is named by its line, and in skip mode set aside with the server's own reason.
* Bad, because the server's own CSV parser is faster than the plugin's; the parse runs in a worker so
  the page stays responsive; the plugin's side ran at about 13.6 MiB/s in that test.
* Bad, because an `.xlsx` larger than 64 MiB is refused: a workbook cannot be read in ranges.
* Neutral, because types are inferred from a sample: a later value outside the type fails the COPY,
  named by its line, and the person widens the column and runs it again.

### Confirmation

`plugins/database/tests/import-copy-*.test.ts` hold the readers, the inference, the source, the run
with batches, skip mode and Cancel, the wizard, its view and the `.xlsx` reader;
`import-copy-live.test.ts` imports a generated file on a real server with the heap measured
(`ENDUE_DB_TEST_POSTGRES`; `ENDUE_DB_TEST_IMPORT_MIB` sizes it). `scripts/plugin-workers.mjs` keeps the
readers in the worker; `scripts/vendor-sheetjs.test.mjs` keeps the two vendored copies equal.

## More Information

ADR 0119 (the import), ADR 0356 (COPY through its session), ADR 0043 (the vendored spreadsheet reader).
`plugins/database/docs/import.md` describes the wizard.
