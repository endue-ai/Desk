# What the Database plugin does

The features of `endue.database`, area by area, each with the modules that hold it (under `ui/`). The
[README](../README.md) keeps the purpose, the permissions, the commands and how to test. A change that adds a
feature adds its line to the area it belongs to, or a section for a new area; it does not grow the README.

The page has one header row (the connection on screen, its environment tag and read-only mark, the buttons;
what does not fit is behind More), the explorer on the left, the work area, and one footer line. Dialogs open
inside the page. `Mod+Shift+B` opens it, and every operation is also a command `endue.database.*`.
Settings are read from what the person set over init.yaml's, and a change applies while the plugin runs;
a change to a client's program or the `path` setting finds the clients again.

Modules: `main.js` (the only one that imports the SDK), `database.js` (the controller), `commands.js`,
`keys.js`, `settings.js`, `view.js`, `view-actions.js`, `dom.js`, `*.css`.

## Connections

- PostgreSQL, MySQL / MariaDB and SQLite, each through its own client and never a shell, in a mode that cannot
  reach past the database (ADR 0038): `psql -X -w` with a `-c` per statement,
  `mysql --binary-mode --local-infile=0`, `sqlite3 -safe`.
- A client is found on the desk's PATH, else in the folders the `path` setting adds and where package managers
  install them; a setting may name another client or its full path. Check the clients says which one runs and
  whether it is new enough (psql 13, mysql 8.0.19, mariadb 10.5, sqlite3 3.37).
- New, change, duplicate, remove (asked first; its history and buffers go with it), test (the server's version
  and the time it took) and disconnect. A connection from a URI (`postgres://`, `mysql://`, `mariadb://`,
  `sqlite:`), and its URI copied back without the password.
- A connection has a group and a colour, an environment tag (production draws a band at the top of the page)
  and can be read-only.
- Passwords are never kept: `~/.pgpass` and `~/.my.cnf` work, else the person types one for the session.
- A SQLite file (`*.sqlite`, `*.sqlite3`, `*.db3`) opened on the desk or dropped on the page opens as a
  connection, added the first time.

Modules: `connections.js`, `manage.js`, `view-form.js`, `clients.js`, `run.js`, `engines/`.

## Explorer

- Connections, then schemas (MySQL's databases, SQLite's main), a folder per kind of object (tables, views,
  materialized views, sequences, routines, events) and, under a table, its columns, keys, foreign keys, indexes
  and triggers. A node is read when it opens and kept until it is refreshed; system schemas show with a setting.
- Keys: Enter opens a table's rows or a connection's console, `/` filters, `g` refreshes, `c` counts rows
  exactly (the server's estimate shows before), `d` shows an object's DDL, `r` draws the schema's ER diagram
  from its foreign keys, `n`, `e` and Delete add, change and remove a connection, `u` adds one from a URI.
- A table drags its qualified name.

Modules: `explorer.js`, `catalog.js`, `schema/`, `view-tree.js`, `view-diagram.js`.

## Console

- A console per connection, a desk buffer that Mod+B and the buffer list reach, its text kept across a restart.
- `Mod+Enter` runs the statement at the caret or the selection, `Mod+Shift+Enter` the script; a script also runs
  in one transaction or as a dry run rolled back at the end, and a statement as EXPLAIN or EXPLAIN ANALYZE.
- A script is cut into statements the way each client cuts it (dollar quotes, comments, DELIMITER, routine
  bodies), and an error's position lands in the editor.
- Highlighting with the lexer that cuts the statements, autocomplete from the schema with aliases
  (`Ctrl+Space`), Format SQL (`Mod+Shift+F`: only space and the case of keywords change), and parameters
  (`:name`, `?`, `$1`) asked for before the run and remembered for the session.
- Guards: a read-only connection refuses writes before the client starts, and on the server too; with
  `confirm` on, a write on a production connection, and DROP, TRUNCATE, or UPDATE and DELETE without WHERE
  anywhere, ask first.
- Cancel, or Escape while a run goes on, sends SIGINT (psql and mysql cancel the query on the server, sqlite3
  interrupts it), then SIGKILL a second later; `timeout-seconds` stops a long run, and PostgreSQL ends it on
  the server.
- History of what ran on each connection, searched from the palette (never results, never a statement that
  carries a password), and starred queries.
- A `.sql` file or SQL text dropped on the page goes into the console on screen, or the console of a connection
  the person picks.

Modules: `consoles.js`, `console-run.js`, `execute.js`, `history.js`, `tools.js`, `sql/`, `editor/`,
`view-editor.js`.

## Results

- A tab per result set and a Messages tab with a line per statement (rows, rows affected, the error with its
  code and detail, not run), the notices and a summary.
- Markers split the output per statement and keep NULL, `''` and `'NULL'` apart. A worker decodes and reads
  it, never the frame's thread, with a bar and Cancel after 300 ms (#38); a run keeps at most 64 MiB of output.
- A grid that draws only the rows in view. A result keeps `max-rows` rows and More rows (`m`) loads four times
  as many; a console's single SELECT pages. Sort (`s`), filter the rows on screen (`/`), one row as a record
  (`t`), and the value viewer (`v`: JSON laid out, text, bytes as a hex dump).
- A table's view filters (WHERE) and orders (ORDER BY) on the server, pages, and counts its rows on request.
- A query plan as a tree: each node's cost and rows, the time and rows it took, and a bar for its own share of
  the whole; the nodes where half or a fifth of it goes are marked.
- Copy the result, or the selected block, as TSV, CSV, JSON, Markdown, INSERT or UPDATE statements, from a
  key or button in the page and from the palette alike (the Clipboard API first, `clipboard.js`).

Modules: `tabs.js`, `results.js`, `clipboard.js`, `pages.js`, `grid-model.js`, `value.js`, `output-client.js`,
`output-worker.js`, `output/`, `explain/`, `view-grid.js`, `view-grid-draw.js`, `view-value.js`, `view-plan.js`.

## Editing

- On a table's view, or a console's plain SELECT of one table: change a cell (Enter or F2, `n` for NULL), add a
  row (`+`), delete rows (Delete), revert them (`u`). The changes stay pending and are drawn as a diff (ADR
  0115).
- Preview (`p`) shows their SQL; Submit (`Mod+Enter`) runs them in one transaction keyed on the primary key and
  reads the rows again, and a failure rolls all of them back.
- Refused without a primary key, when the key is not in the result, and on a read-only connection; a change
  that matched no row is said.

Modules: `edits.js`, `edit/`, `view-cell.js`.

## Import and export

- Export a result to `~/Downloads` in any copy format, as `<table>-<time>.<extension>` so it never overwrites
  an earlier one, and show it in the file manager.
- A dropped `.csv`, `.tsv` or `.json` file opens an import (ADR 0119): into the table it landed on or one named
  like it, with a column mapping and a preview, every INSERT in one transaction, 512 KiB of SQL at most.
  Read-only connections refuse it and production asks.
- A dropped file is read with `fs.read` and asked for once (see the README's permissions).
- Rows of a result drag as `db/rows` `{ connection, engine, schema?, table?, columns, rows }`, as INSERT
  statements (`desk/text`) and as TSV (`text/plain`).

Modules: `export.js`, `import.js`, `importer.js`, `drops.js`, `dropped.js`, `dnd.js`, `view-dnd.js`,
`view-import.js`.

## Server activity

- A panel per PostgreSQL connection (13 and later) with its sessions from `pg_stat_activity`: process id,
  user, database, application, client, state, wait event, how long in its state, transaction and statement,
  and the statement; the selected one's whole statement below. Columns sort; filters hide idle sessions
  and this view's own, show background processes, and keep one database.
- Who waits for whom (`pg_blocking_pids`) as a tree, the longest wait first, with the lock waited for and
  how its blocker holds it; the locks from `pg_locks` (5,000 at most), the waiting ones first.
- Read again by hand (Refresh, `g`) and every 2, 5, 10, 30 or 60 seconds while on screen; Pause (`p`)
  stops that. What another role's session hides from this one (without `pg_read_all_stats`) is counted.
- Cancel a statement (`pg_cancel_backend`, `c`) or end a session (`pg_terminate_backend`, `e`): always
  asked first with its statement shown, production named first; refused on a read-only connection; the
  server's refusal said in its words (ADR 0290). Keys: arrows, Home and End select, Enter shows the whole
  statement.

Modules: `features/activity/`.

## Agents

- `endue.database.connections` (never a password), `.schema` and `.query` (100 rows a statement by default,
  1000 at most) are registered with an argument schema as agents' tools (ADR 0088); the first two only read.
- An agent's write runs only after the person says yes, whatever the connection's tag and the `confirm`
  setting; a read-only connection refuses it, and an agent is never shown a password prompt.
- `.activity` answers a connection's sessions and who waits for whom, and only reads; `.cancel-session` and
  `.end-session` are irreversible: the core waits for the person's approval, then the plugin asks as it
  asks the person (ADR 0290).

Modules: `agent.js`.
