# The Database plugin's export

A result written to a file (PG-61, ADR 0341). The rest of the plugin is in [`features.md`](features.md); a
change to exporting adds its line here.

- Database: export the result to a file writes the result on screen, or the grid's selection. Without a
  format the palette asks, then the options dialog, filled with the options that format had last time.
  Options given as arguments (an agent's, a key's) skip the dialog; a named format without options takes
  its last ones.
- The place is always the one the person chooses in the desk's save dialog (`dialog.save`), which starts
  in the folder of the last export and grants that one path. The command takes no path, so an agent's
  export still asks the person where. The suggested name is `<table>-<time>.<extension>`.
- Formats: TSV, CSV, JSON, Markdown, SQL INSERT and SQL UPDATE (the copy formats, written as before by
  default), an `.xlsx` workbook, an HTML table, XML and the person's own template.
- Options, as each format reads them: delimiter, quoting (when needed, always, never), a header row, the
  text for NULL, the line ending (LF, CRLF), the encoding (UTF-8, UTF-16 LE or BE) with or without a byte
  order mark; for SQL the target table and the rows per INSERT; for a template a first line, each row
  (`{{column}}`, `{{1}}` for the first column, `{{#}}` for the row's number), what goes between rows, and
  a last line. A line break inside a value is never changed by the line ending.
- An `.xlsx` is written by the plugin (no library): typed cells, a number only when it has at most 15
  significant digits (else text, as the server sent it), a date or a timestamp without a time zone from
  1900-03-01 on as a date cell (with a time zone or past milliseconds: text), the header row bold and
  frozen, NULL an empty cell. The result on screen is one sheet; ticking Every result of the console puts
  each result tab in a sheet of its own. Past 20,000 cells the file is written in a worker.
- HTML marks a NULL cell `data-null`; XML writes `<rows><row><value column="…">`, NULL as `null="true"`,
  and a value with a character XML cannot hold as `encoding="base64"`.
- An export of the rows held says so, in the status line and as `partial` in the answer, when the server
  has more. Exporting every row of a large table is PG-64.
- The comparison's difference (`features/compare/`) is exported through the same save dialog.

Modules: `export.js`, `export/` (options, text, bytes, cells, xlsx, zip, file, client, worker),
`features/export/`.
