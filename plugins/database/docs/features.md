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
- A PostgreSQL connection's schema is read once into a cache (ADR 0285) that the explorer, completion and the
  ER diagram read: one statement per kind for every chosen schema, with progress and Cancel. It is kept in the
  plugin's store across restarts, and on connect and on `g` a fingerprint statement says which schemas changed;
  only those are read again, and a DDL statement run from the plugin starts that check. The connection's line
  says when it was read. Database: read the schema again reads it all; Database: choose the schemas to read
  picks them (system schemas stay out by default). Other engines read a node when it opens, as above.
- Keys: Enter opens a table's rows or a connection's console, `/` filters, `g` refreshes, `c` counts rows
  exactly (the server's estimate shows before), `d` shows an object's DDL, `r` draws the schema's ER diagram
  from its foreign keys, `n`, `e` and Delete add, change and remove a connection, `u` adds one from a URI.
- A table drags its qualified name.

Modules: `explorer.js`, `catalog.js`, `schema-cache/`, `features/schema-cache/`, `schema/`, `view-tree.js`,
`view-diagram.js`.

## Console

- As many consoles per connection as the person opens (Database: new console), each a desk buffer that Mod+B
  and the buffer list reach, with an id of its own and its own text, results, parameters and history entries,
  named `Shop`, `Shop 2` or as renamed (`Shop · Audit`), listed in the palette (Database: show a console),
  closed by command, and all back after a restart; Open a console shows the one used last (ADR 0286).
- A console's text is kept across a restart; past the store's 64 KiB, whole in a file of the plugin's own.
- `Mod+Enter` runs the statement at the caret or the selection, `Mod+Shift+Enter` the script; a script also runs
  in one transaction or as a dry run rolled back at the end, and a statement as EXPLAIN or EXPLAIN ANALYZE.
- A script is cut into statements the way each client cuts it (dollar quotes, comments, DELIMITER, routine
  bodies), and an error's position lands in the editor.
- Highlighting with the lexer that cuts the statements, autocomplete from the schema with aliases
  (`Ctrl+Space`), Format SQL (`Mod+Shift+F`: only space and the case of keywords change), and parameters
  (`:name`, `?`, `$1`) asked for before the run and remembered for the console.
- Guards: a read-only connection refuses writes before the client starts, and on the server too; with
  `confirm` on, a write on a production connection, and DROP, TRUNCATE, or UPDATE and DELETE without WHERE
  anywhere, ask first.
- Cancel, or Escape while a run goes on, sends SIGINT (psql and mysql cancel the query on the server, sqlite3
  interrupts it), then SIGKILL a second later; `timeout-seconds` stops a long run, and PostgreSQL ends it on
  the server.
- History of what ran on each connection, searched from the palette (never results, never a statement that
  carries a password), and starred queries.
- SQL text dropped on the page goes into the console on screen, or the console of a connection the person picks.
- A `.sql` file opened from the desk or dropped is a console bound to it, on the connection the file remembers,
  the console on screen's for a drop, else the one picked (Database: run this .sql file on another connection
  changes it). The desk saves and reverts it as a file: an edit marks it unsaved, Save writes that file and no
  other, asked for at its first save; a change on disk goes to the desk, which asks before edits are replaced.
- Database: run a .sql file runs a script of any size from disk, never in the editor: read in ranges, cut as the
  console cuts a script, run in parts under every guard of a console run, SET statements carried into each
  part; a progress line, and the first error stops it at its line in the file.

Modules: `consoles.js`, `console-many.js`, `console-list.js`, `console-text.js`, `console-files.js`,
`console-run.js`, `features/consoles/`, `execute.js`, `history.js`, `tools.js`, `sql/`, `editor/`,
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
- Columns hidden (`h`, `H` shows one again), moved (`<` `>`, or a header dragged), pinned at the left (`P`),
  resized (a header's grip, `(` `)`, `w` or a double click on the grip fits). A table view keeps them across
  restarts, a console's result while it is among the last 20 (ADR 0288). Copy, export and drags take the
  columns on screen, in their order.
- Sort by more than one column (Shift+click or `S` adds the next key, numbered in the header). Quick filters
  from the cursor's cell (`f` menu, `=` equals, `F` clears): =, ≠, >, <, contains, empty, NULL, not NULL,
  each a chip that says whether it runs on the server (a table view: its keys go to ORDER BY and its filters
  join WHERE) or on the rows on screen. Find in the result (Mod+F in the grid; Enter, Shift+Enter, F3) with
  match case and whole cell. Past 10,000 rows the frame's sorts, filters and find run in a worker.
- A query plan as a tree: each node's cost and rows, the time and rows it took, and a bar for its own share of
  the whole; the nodes where half or a fifth of it goes are marked.
- A query plan as a tree, a flame of each node's own time (its cost when the plan did not run), or a table sorted
  by any column (ADR 0289): each node's estimated rows against the rows it returned over all its loops and the
  factor between them, its own time apart from its children's, its buffers, and a bar for its share of the whole.
  Marks say in words where a plan goes wrong: ten times more or fewer rows than estimated, a scan that filters
  most of what it reads away, a sort or hash that spilled to disk, an inner side that ran a thousand times, an
  index scan whose filter drops most of what the index found. Above it the statement's totals: planning and
  execution time, buffers, WAL, triggers, JIT, serialization, planner memory and the settings that differ.
- EXPLAIN with options on PostgreSQL: ANALYZE, BUFFERS, VERBOSE, SETTINGS, WAL, TIMING and SUMMARY, and
  GENERIC_PLAN, SERIALIZE and MEMORY on the servers that have them, remembered per connection. ANALYZE runs the
  statement: a write runs in a transaction rolled back at the end, under the same guards as any run.
- Two plans compared side by side, from a console's last eight or from two consoles: the nodes paired by type
  and relation, and what changed in each (its type, cost and time). A plan copies as text or as JSON; a JSON
  plan over 64 KiB is read in a worker.
- Copy the result, or the selected block, as TSV, CSV, JSON, Markdown, INSERT or UPDATE statements, from a
  key or button in the page and from the palette alike (the Clipboard API first, `clipboard.js`).

Modules: `tabs.js`, `results.js`, `clipboard.js`, `pages.js`, `grid-model.js`, `value.js`, `output-client.js`,
`output-worker.js`, `output/`, `explain/`, `view-grid.js`, `view-grid-draw.js`, `grid/`, `features/grid/`,
`view-value.js`, `view-plan.js`.
`output-worker.js`, `output/`, `explain/`, `view-grid.js`, `view-grid-draw.js`, `view-value.js`, `view-plan.js`,
`view-plan-flame.js`, `view-plan-table.js`, `view-plan-marks.js`, `view-dialog.js`, `features/plans/`.

## Editing

- On a table's view, or a console's plain SELECT of one table: change a cell (Enter or F2, `n` for NULL), add a
  row (`+`), delete rows (Delete), revert them (`u`). The changes stay pending and are drawn as a diff (ADR
  0115).
- Preview (`p`) shows their SQL; Submit (`Mod+Enter`) runs them in one transaction keyed on the primary key and
  reads the rows again, and a failure rolls all of them back.
- Refused without a primary key, when the key is not in the result, and on a read-only connection; a change
  that matched no row is said.
- A cell is edited by its column's type (ADR 0287): a toggle for a boolean, the labels of an enum, text with
  a picker for a date, time or timestamp (the session's time zone shown for one with a zone), an interval,
  JSON laid out with Format, an array as its elements each checked by the element's type, bytes as hex with
  their size, loaded from and saved to a file, a UUID with Generate. On PostgreSQL the type is read from the
  catalog, a domain by its base type; MySQL's enum and SQLite's BLOB by their declared names. What the type
  refuses is said in the editor before it is pending; a refusal on Submit names the row and the column.
- Enter or F2 opens a cell's editor, Enter keeps (Mod+Enter in JSON, an array and bytes), Escape cancels,
  Alt+N sets NULL and Alt+D DEFAULT, a pending value of its own (Database: set the cell to DEFAULT). A
  generated or always-identity column says why it cannot change.

Modules: `edits.js`, `edit/`, `view-cell.js`, `cell-editors/` (`resolve.js`, `pg-types.js`, `values.js`,
`panel.js`, one module per kind), `features/cell-values/`.

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
