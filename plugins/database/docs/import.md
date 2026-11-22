# The Database plugin's import by COPY

How a file dropped on a PostgreSQL connection goes into a table (PG-60, ADR 0363). The other engines keep the
INSERT import of ADR 0119 ([`features.md`](features.md)). A change to it adds its line here.

- A dropped `.csv`, `.tsv` (PostgreSQL's text format), `.json` (an array, read whole up to 16 MiB), `.jsonl` or
  `.ndjson` (one value per line) or `.xlsx` (its first sheet) opens the import wizard. Only the file's first
  1 MiB is read to open it (an `.xlsx` is read whole, up to what fits: a workbook is a ZIP).
- Into the table it landed on, one named like the file, or a new table: when no table is named like the file,
  a new one named after it. A new table's columns are the file's, each a plain SQL name and the narrowest type
  every value of the first 1,000 rows reads as (boolean, integer, bigint, numeric, date, timestamp, timestamptz,
  uuid, jsonb, else text); the person renames, retypes or leaves out any of them before anything runs.
- How the file reads: the encoding (any the frame's TextDecoder reads), the delimiter, the quote and the escape
  (CSV), the text that means NULL (an empty unquoted field by default; `\N` in the text format), the rows to
  skip before the header, the header line, trimming the spaces around values, and the date order (day,
  month or year first: `SET LOCAL DateStyle`). A change reads the sample again.
- The preview shows the first rows as they will be sent; Check on the server copies the first 20 into a
  temporary table in a transaction that always rolls back and shows them as the server read them, or its error.
- Import runs on a session of its own, closed after: BEGIN, CREATE TABLE for a new table, `COPY ... FROM
  STDIN` and COMMIT. The plugin parses the file (in a worker of its own) and sends COPY's text format in
  chunks of 1 MiB at most, read from the file in 1 MiB ranges: nothing holds the file whole.
- Rows per transaction commit every N rows; by default all go in one transaction. A failure keeps only the
  batches committed before it, and says how many.
- On an error, by default, the import stops and rolls back, naming the row's line. Skip mode asks where the
  reject file goes (the save dialog), sends the rows in segments of 10,000 under a savepoint, and writes each
  row the server refuses to it as `row`, `reason` (the server's) and its values, then sends the segment again
  without it; past 1,000 refused rows it stops and rolls back.
- The bar under the preview shows the rows sent and the bytes read of the file's size; its Cancel and the
  wizard's stop the COPY (CopyFail) and roll back.
- Guards: a read-only connection refuses it; a production one asks once, showing the CREATE TABLE and the
  COPY; the statement timeout applies to each COPY. Agents have no import.
- Code: `ui/import-copy/`: `csv.js`, `lines.js` (readers), `transform.js` (COPY lines), `sample.js`,
  `infer.js`, `xlsx.js` (the vendored reader, `ui/vendor/sheetjs`), `worker.js`, `answer.js`, `client.js`,
  `source.js`, `run.js`, `rejects.js`, `start.js`, `wizard.js`, `branch.js`, `view.js`.
