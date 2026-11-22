# The Database plugin's COPY through a file

How a PostgreSQL console runs `COPY ... TO STDOUT` and `COPY ... FROM STDIN` (PG-23), and the call the
plugin's other parts use for the same stream. A change to it adds its line here.

- `COPY ... TO STDOUT` typed in a console asks where to save (the desk's save dialog, which grants that one
  path), suggesting the table's name and the format's extension (`items.csv`, `.txt` for the text format,
  `.bin` for binary), and writes the rows there as they come. `COPY ... FROM STDIN` asks for the file to read
  (the open dialog, which grants the file chosen) and sends it. A cancelled dialog runs nothing.
- Rows move in chunks of 1 MiB both ways: each page of the COPY out is written as it arrives (the first write
  replaces the file, the next ones append: `fs.write` `append`, ADR 0356), and the file to copy in is read in
  1 MiB ranges. Nothing holds the file whole; an empty COPY out still makes its file.
- While it runs the console's bar shows the bytes: written for a COPY out (no total is known), sent and the
  file's size for a COPY in. Its Cancel, the console's Cancel and Escape stop it: a COPY out is closed (the
  server cancels it), a COPY in is failed (CopyFail), so nothing of a cancelled COPY in stays, and the
  console's session is ready for the next statement.
- A row the server refuses ends the COPY with its error led by the file's line, from the server's context
  (`items.txt, line 3: invalid input syntax for type integer`); a COPY out that fails leaves what it wrote.
- Guards: `COPY ... TO STDOUT` reads, so a read-only connection runs it, unless its query writes (`INSERT`,
  `UPDATE`, `DELETE` or `MERGE` with RETURNING); `COPY ... FROM STDIN` writes, so a read-only connection
  refuses it and a production one asks. A `COPY` to or from a file or a program on the server stays a write.
- A COPY through standard input or output runs on its own: in a script with other statements it is refused,
  so its file is chosen for it. An agent's is refused: the file is the person's choice.
- COPY takes no bound values, so one with parameters is refused: write the values into its query. A check
  (run nothing, describe) refuses it too, before any dialog: it would have nothing to say without the file.
- The statement timeout applies to a COPY as to any statement.
- The stream is a call: `ui/copy/index.js` `copyOut(execute, conn, sql, sink, options)` and `copyIn(execute,
  conn, sql, source, options)` run through `deps.execute`, so the guards, the console's session and Cancel
  hold; `fileSink(bridge, path)` and `fileSource(bridge, path)` make a sink and a source of a file, and any
  object with `write(chunk)` (and `close()`) or `read()` serves.
- A whole export (PG-64, [`export-all.md`](export-all.md)) runs its COPY through the same call: `direct.js` says
  when the server's CSV or text bytes are the file, `text.js` reads the text format back into rows, and
  `partial.js` writes under a temporary name renamed at the end.
- Code: `ui/copy/statement.js` (which way a COPY goes), `plan.js` (when it may run), `stream.js` (the chunks,
  cancel and the line), `files.js`, `console.js` (the dialogs and the bar), `index.js`.
