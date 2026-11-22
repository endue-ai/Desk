# The Database plugin's whole export

Every row of a table or a query, or every table of a schema, written straight to files however large (PG-64,
ADR 0365). The result's own export, which writes the rows the grid holds, is [`export.md`](export.md).

- Database: export every row to a file exports the table a table view shows, or the statement of the result on
  screen (one read: `SELECT`, `VALUES`, `TABLE` or `WITH ... SELECT` that changes nothing, without bound
  values). An agent or a key may name `sql` or `table` (`schema.table`) and `connection` instead. The format
  is picked, then the options dialog asks as the result's export asks (the same last options), with Compress
  with gzip besides; the place is the save dialog's, suggested as `<table>-<time>.<extension>`.
- Database: export tables to a folder picks a schema (or takes `schema`, and `tables` to narrow it), the format
  and options, then a folder in the desk's folder dialog: one file a table (`<table>.<extension>`, `.gz` when
  compressed), the tables, partitioned tables, views, materialized views and foreign tables of the schema, a
  partition not on its own. A file already there is kept: the next free name is taken (`items-2.csv`). The
  folder is asked for once.
- Everything is read in one transaction, `START TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`, on a
  session of the export's own (never a console's), so every file of a folder sees the same snapshot and none
  can write; it ends with `ROLLBACK`, whatever came of it. PostgreSQL only.
- The rows come from `COPY (<query>) TO STDOUT` in pages of 1 MiB ([`copy.md`](copy.md)) and never reach the
  grid: the frame holds one page and the bytes made of it. CSV and TSV take the server's own bytes when they
  are the file: CSV with LF, UTF-8, quoting when needed, an ASCII delimiter, a NULL text the server takes and at
  least two columns (the server also quotes a lone `\.` of one column); TSV is COPY's text format (which also
  writes backspace, form feed and vertical tab as `\b`, `\f`, `\v`), its header from PostgreSQL 15 on. Anything
  else reads COPY's text format back and writes it through the plugin's writers, exactly as the result's export
  writes those rows, in the export's worker. JSON keeps a column's values numbers when its type is a number
  type.
- An `.xlsx` is streamed as one sheet (the format's zip with the sheet deflated as it comes); past 1,048,576
  rows it stops with a sentence. It takes no gzip.
- The file is written as `.<name>.partial` beside the chosen one (asked for once, then appended to) and renamed
  at the end; a file already at the chosen name goes to the OS trash just before. Cancel, or a failure, closes
  the COPY on the server and moves the temporary file to the trash: nothing stays at either name.
- The export's panel shows every file with its rows and bytes as they grow, its status, Cancel while it runs,
  and the end's sentence. Database: cancel the export stops the one on screen or the only one running.
- Modules: `features/export-all/` (source, snapshot, file, jobs, panel, dialog, run), `copy/direct.js`,
  `copy/text.js`, `copy/partial.js`, `export/stream.js`, `export/pipe.js` (and its worker and client),
  `export/xlsx-stream.js`, `export/zip-stream.js`, `export/deflate.js`.
