# What the Database plugin does

The features of `endue.database`, area by area, each with the modules that hold it (under `ui/`). The
[README](../README.md) keeps the purpose, the permissions, the commands and how to test. A change that adds a
feature adds its line to the area it belongs to, or a section for a new area; it does not grow the README.

The page has one header row (the connection on screen, its environment tag and read-only mark, the buttons;
what does not fit is behind More), the explorer on the left, the work area, and one footer line. Dialogs open
inside the page. `Mod+Shift+B` opens it, and every operation is also a command `endue.database.*`.
Settings are read through `settings.get` and followed through `settings.changed`, in force with no reload; a
wrong value keeps its default and is said once (`settings-follow.js` says what each change does at once).

Modules: `main.js` (the only one that imports the SDK), `database.js` (the controller), `commands.js`,
`keys.js`, `settings.js`, `settings-follow.js`, `view.js`, `view-actions.js`, `dom.js`, `*.css`.

## Connections

- PostgreSQL runs on the desk core's own sessions (`db.*`, ADR 0281), with no client program: a console and a
  table view keep one each (ADR 0320), other runs open one and close it; `db:connect` is asked for a host and port
  at its first run. TLS follows the connection's mode (`require`, `verify-ca`, `verify-full`) and CA file, and
  presents a client certificate (`docs/client-cert.md`); a socket folder or an IPv6 host is not supported yet.
- MySQL / MariaDB and SQLite run their own client and never a shell, in a mode that cannot reach past the
  database (ADR 0038): `mysql --binary-mode --local-infile=0`, `sqlite3 -safe`.
- A client is found on the desk's PATH, else in the folders the `path` setting adds and where package managers
  install them; a setting may name another client or its full path. Check the clients says which one runs and
  whether it is new enough (mysql 8.0.19, mariadb 10.5, sqlite3 3.37), and that PostgreSQL needs none.
- New, change, duplicate, remove (asked first; its history and buffers go with it), test (the server's version
  and the time it took) and disconnect. A connection from a URI (`postgres://`, `mysql://`, `mariadb://`,
  `sqlite:`), its URI copied back without the password; many moved in one file ([`connections-file.md`](connections-file.md)).
- A connection has a group and a colour, an environment tag (production draws a band at the top of the page)
  and can be read-only.
- Passwords are never kept with a connection: `~/.pgpass` (read by the desk core) and `~/.my.cnf` work, else
  the person types one for the session. A PostgreSQL connection can have the OS keychain remember it (ADR 0311):
  the choice in the form and in the password prompt keeps a typed password once it works, or a URI's on Save,
  through the desk, which never hands it back; a session signs in with it by `passwordRef`, so no prompt comes
  after a restart. The connection's line says `keychain`; Database: forget the remembered password, turning the
  choice off, changing the server or user, or removing the connection forgets it. Disconnect leaves it
  (`keychain.js`, `engines/pg-session.js`).
- A SQLite file (`*.sqlite`, `*.sqlite3`, `*.db3`) opened on the desk or dropped on the page opens as a
  connection, added the first time.

Modules: `connections.js`, `manage.js`, `keychain.js`, `view-form.js`, `clients.js`, `run.js`, `engines/`,
`features/keychain/`.

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
- A PostgreSQL schema also has Types (enum, composite, domain, range, base), Aggregates, Operators, Collations
  and Text search; a table its Partitions with their bounds, the parents it Inherits from, Policies and Rules,
  and its row says whether row security is on and about how large it is. After the schemas, Database holds
  Extensions (with what each owns), Foreign data wrappers, Foreign servers, User mappings, Publications,
  Subscriptions, Event triggers, Casts and Languages, and Server holds Roles and Tablespaces (ADR 0295). All of
  it comes from the cache, `d` shows each one's DDL (its owner on the first line), and completion offers a
  schema's types. Passwords are never read: not a user mapping's options, a subscription's connection string, a
  role's password, or an option named like a secret.
- Keys: Enter opens a table's rows or a connection's console, `/` filters, `g` refreshes, `c` counts rows
  exactly (the server's estimate shows before), `d` shows an object's DDL, `r` draws the ER diagram of a
  schema (of the tables the filter keeps) or of a table and its neighbours, `m` opens the maintenance form of
  a connection, schema, table or index, `x` opens the form of a PostgreSQL function or procedure, `f` searches
  a connection's, schema's or table's values (Value search below), `n`, `e` and Delete add, change and remove
  a connection, `u` adds one from a URI.
- A table drags its qualified name; a PostgreSQL connection lists its server's databases ([`databases.md`](databases.md)).

Modules: `explorer.js`, `catalog.js`, `schema-cache/`, `features/schema-cache/`, `schema/` (PostgreSQL's other
kinds in `schema/pg/`), `view-tree.js`.

## Objects

- From a row (`o`, the context-menu key or a right click opens its menu; `F2` renames, `s` opens the
  source) or a command with arguments: rename, move to another schema, change the owner, comment (empty
  removes it), drop, truncate (RESTART IDENTITY, CASCADE), refresh a materialized view (CONCURRENTLY when it
  has data and a unique index, WITH NO DATA), enable or disable a trigger, and generate SQL (SELECT, INSERT,
  UPDATE, DELETE of a table, a call of a routine) into a console with `:name` parameters.
- Every one shows its exact script in a dialog first, rewritten as the person types and chooses, and runs it
  through the guards: a read-only connection refuses before the dialog, a production one is asked again
  with its tag named, DROP and TRUNCATE are asked as dangerous, and an agent's request waits for the
  person's answer in the same dialog (ADR 0312). The schema cache reads what changed again.
- A drop lists what depends on the object first (PostgreSQL's `pg_depend`, 200 at most): what a plain DROP
  is refused for, and what goes with it. CASCADE is a choice of its own, never on unless chosen.
- A view's, a materialized view's, a function's, a procedure's or a trigger's function's source opens in a
  console of its own; Database: apply the source shows the script and runs it in one transaction
  (`CREATE OR REPLACE`; a materialized view is dropped and created again with its indexes and comment, and
  refused while others depend on it). An error selects its line.
- MySQL and SQLite get what their DDL allows (`features/objects/kinds.js`): MySQL renames and moves tables,
  comments tables and routines, drops and truncates; SQLite renames tables, drops, and empties a table with
  DELETE; a view's source is applied as CREATE OR REPLACE (MySQL) or dropped and created (SQLite). What an
  engine cannot do is said as such.

Modules: `features/objects/`.

## Table design

A PostgreSQL table created and changed in a form that shows its script first: [`table-design.md`](table-design.md). Two schemas compared and the migration script between them: [`schema-compare.md`](schema-compare.md).

## Roles and privileges

What a role may do and why, and its privileges changed by the exact script: [`privileges.md`](privileges.md).

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
- Highlighting with the lexer that cuts the statements, completion from the schema (`Ctrl+Space`, below),
  Format SQL (`Mod+Shift+F`, below), and parameters (`:name`, `?`, `$1`) asked for before the run and
  remembered for the console.
- Guards: a read-only connection refuses writes before anything runs, and on the server too
  (`default_transaction_read_only` on PostgreSQL's session); with
  `confirm` on, a write on a production connection, and DROP, TRUNCATE, or UPDATE and DELETE without WHERE
  anywhere, ask first.
- Cancel, or Escape while a run goes on, cancels PostgreSQL's statement on the server (`db.cancel`), and sends
  the other clients SIGINT (mysql cancels the query on the server, sqlite3 interrupts it), then SIGKILL a
  second later; `timeout-seconds` stops a long run, and PostgreSQL ends it on the server (`statement_timeout`).
- On PostgreSQL each console and each table view keeps a session of its own, so what one run sets the next
  sees (ADR 0320): [`sessions.md`](sessions.md).
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
`console-run.js`, `features/consoles/`, `execute.js`, `engines/pg-session.js`, `history.js`, `tools.js`, `sql/`,
`editor/`, `view-editor.js`.

## Format SQL, SQL problems and completion

Laying SQL out, underlining what the server would refuse, completion: [`editor.md`](editor.md). From a name to its definition, its card and its usages: [`navigate.md`](navigate.md). Eris writing, explaining and fixing a console's SQL, and what is sent: [`assist.md`](assist.md). Renaming with what keeps the dependents working, extracting and inlining CTEs, qualifying names: [`refactor.md`](refactor.md).

## Results

- A tab per result set and a Messages tab with a line per statement (rows, rows affected, the error with its
  code and detail, not run), the notices and a summary.
- Markers split the output per statement and keep NULL, `''` and `'NULL'` apart. A worker decodes and reads
  it, never the frame's thread, with a bar and Cancel after 300 ms (#38); a run keeps at most 64 MiB of output.
- A grid that draws only the rows in view. A PostgreSQL console's single read of any size scrolls to its end
  through a cursor on its session ([`rows.md`](rows.md)); elsewhere a result keeps `max-rows` rows and More
  rows (`m`) loads four times as many. Sort (`s`), filter the rows on screen (`/`), one row as a record
  (`t`), and the value viewer (`v`: JSON laid out, text, bytes as a hex dump).
- A table's view filters (WHERE) and orders (ORDER BY) on the server, pages, counts its rows on request, and
  unsorted reads a PostgreSQL table by its primary key (`ctid` without one), so rows keep their places.
- Columns hidden (`h`, `H` shows one again), moved (`<` `>`, or a header dragged), pinned at the left (`P`),
  resized (a header's grip, `(` `)`, `w` or a double click on the grip fits). A table view keeps them across
  restarts, a console's result while among the last 20 (ADR 0288); copy, export and drags take them as shown.
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
  plan over 64 KiB is read in a worker. Pinned results, comparisons, totals and charts: [`results.md`](results.md).
- Copy the result, or the selected block, as TSV, CSV, JSON, Markdown, INSERT or UPDATE statements, from a
  key or button in the page and from the palette alike (the Clipboard API first, `clipboard.js`).
- A Map tab draws a result's geometry and geography values, linked to the grid: [`map.md`](map.md).

Modules: `tabs.js`, `results.js`, `clipboard.js`, `pages.js`, `grid-model.js`, `value.js`, `output-client.js`,
`output-worker.js`, `output/`, `explain/`, `view-grid.js`, `view-grid-draw.js`, `grid/`, `features/grid/`,
`view-value.js`, `view-plan.js`, `view-plan-flame.js`, `view-plan-table.js`, `view-plan-marks.js`, `view-dialog.js`,
`features/plans/`.

## Editing

- On a table's view, or a console's plain SELECT of one table: change a cell (Enter or F2, `n` for NULL), add a
  row (`+`), delete rows (Delete), revert them (`u`). The changes stay pending and are drawn as a diff (ADR 0115).
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

- Paste (Mod+V in the grid, Database: paste into the grid) fills cells from the block's top-left cell, down the
  rows in their order on screen and right over the shown columns (hidden ones skipped, pinned first); rows
  past the last become pending rows. It reads tab-separated text (the grid's own copy with its `\N` and
  escapes, a spreadsheet's with quoted fields), CSV when every line splits into the same number of fields,
  and one value, which goes into every selected cell. Each value is checked by its column's type (an empty
  one in a typed column is NULL); one bad value refuses the whole paste, naming its row and column, before
  anything is pending. A first line naming the columns is left out. More than 1,000 cells ask first; text
  over 16 KiB is read in a worker. Agents paste with `text`, under the same refusals.
- Duplicate (`D`, the cell's menu, Database: duplicate the selected rows) adds the selected rows as pending rows; an identity, a
  generated column, a `nextval()` default, a key with a default and SQLite's INTEGER PRIMARY KEY take DEFAULT
  and are named, and a key copied as it was is named to change. Fill down (`"`) copies the block's top row
  below; `n` on a block sets every cell NULL (Database: clear the selected cells to NULL).
- Undo (Mod+Z in the grid, the Undo button, Database: undo the last pending change) takes back one step: a
  cell, a paste, a duplicate, a fill, a clear, rows added, deleted or reverted; 100 steps are kept.

Modules: `edits.js`, `edit/` (`cells.js`, `duplicate.js`, `history.js`, `paste-text.js` for the paste),
`view-cell.js`, `cell-editors/` (`resolve.js`, `pg-types.js`, `values.js`, `panel.js`, one module per kind),
`grid/paste.js`, `grid/paste-worker.js`, `features/cell-values/`, `features/paste/`.

## Foreign keys

- On PostgreSQL, a foreign key's cells in a table's view or a console's plain SELECT of one table are links,
  their title saying where they point (ADR 0322). `g` or Mod+click (the cell's menu, Database: go to the row
  this key points at) opens the referenced table's view under one `=` quick filter per key column, its typed
  WHERE cleared; a NULL, or a key column missing from the result, is said instead.
- `r` (Database: show the rows that point at this row) lists the tables whose keys point at the row, counted
  in one run when asked, and opens one filtered the same way. `b` (Database: go back to where the key was
  followed from) shows the view as it was: WHERE, order, sort keys, filters and page; 50 steps are kept.
- Enter or F2 on an editable key cell (Database: pick the key from the referenced table) searches the
  referenced table in the palette: 50 rows a page by key with its first text column, More rows, typed text
  searched on the server, and the text as it is for a key of one column. The whole key is one pending step.
- Keys come from the schema cache when it holds the table's schema, else from one read of `pg_constraint`.

Modules: `links/`, `features/links/`.

## Import and export

- Export a result where the person chooses, in ten formats with their options: see [`export.md`](export.md).
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
  user, database, application, client, state, wait event, time in its state, transaction and statement, and
  the statement, whole below; columns sort; filters hide idle sessions and the view's reads (with their locks),
  show background processes and keep one database; `this view` and `this desk` (`db.list`) mark the desk's own.
- Who waits for whom (`pg_blocking_pids`) as a tree, the longest wait first, with the lock waited for and
  how its blocker holds it; the locks from `pg_locks` (5,000 at most), the waiting ones first.
- Read again by hand (Refresh, `g`) and every 2, 5, 10, 30 or 60 seconds while on screen; Pause (`p`)
  stops that. What another role's session hides from this one (without `pg_read_all_stats`) is counted.
- Cancel a statement (`pg_cancel_backend`, `c`) or end a session (`pg_terminate_backend`, `e`): always
  asked first with its statement shown, production named first; refused on a read-only connection; the
  server's refusal said in its words (ADR 0290). Keys: arrows, Home and End select, Enter shows the whole statement.

Modules: `features/activity/`.

## Server overview

- Database: server overview opens one panel per PostgreSQL connection (13 and later) that only reads
  catalogs, statistics views and size functions: the server's figures (connections against the limit, cache
  hit ratio, commits, deadlocks, temporary files, checkpoints), database, schema, table and index sizes with
  TOAST apart, indexes scanned fewer than 50 times, duplicate and invalid indexes, sequential scans, dead rows
  with the last vacuum and analyze and when autovacuum comes, transaction id age against wraparound, cache
  hits, the heaviest statements from `pg_stat_statements` (or how to enable it), transactions open for more
  than a minute, replication (a standby's own lag), slots, and settings changed from their defaults, searched.
- Each section names the statistic it comes from and when its counters were reset. One the role may not read
  says so and the rest are read; the header says what a role outside `pg_monitor` cannot see. A size waiting
  2 s behind another session's lock fails its section instead of the overview.
- Refresh reads again. Open in console runs a section's SQL in the console as a normal result (copy, export);
  a heavy statement opens there unrun.

Modules: `features/overview/`.

## ER diagram

- A diagram of a schema, of several, of the tables the explorer's filter keeps, or of a table and its
  neighbours 1 to 9 foreign keys away either way (Database: ER diagram of a table and its neighbours). A
  PostgreSQL connection's diagram reads the schema cache (ADR 0285); other engines read their catalog.
- Each table shows its columns with type, `null` for a nullable one, PK and FK, and its comment as a tooltip;
  all columns (the first 50, then how many more), keys only, or none. Each line names its foreign key; its ends
  say one, zero or one, or many. Tables of other schemas are named with their schema.
- Laid out in layers over the foreign keys, a referenced table left of those that refer to it, lines routed
  round the tables; Auto layout (`a`) lays it out again. A table dragged, or moved with Shift and the arrows, stays
  where it was put: the layout is kept per connection and diagram in the plugin's store across restarts
  (ADR 0315). A new table lands beside the placed ones; a dropped one leaves.
- Add or remove a table, add a table's neighbours (`n`) or a schema, and draw a relation the database does not
  declare (dashed, said to be not in the database, kept with the diagram).
- Export image… writes SVG (the theme's colours as values) or PNG at 1x or 2x where the save dialog says,
  asking once for the path when it is not granted (ADR 0260); Copy image puts a PNG on the clipboard. Either
  holds the diagram alone.
- Wheel pans, Mod and the wheel zooms, a drag on the background pans; Fit, `+`, `-` and `0` set the zoom; past
  30 tables a map shows where the view is. Arrows move between tables, Enter opens one, Delete removes it.
  From 200 tables the layout runs in a worker; boxes away from the view are not drawn, nor rows far out.

Modules: `features/diagram/`, `schema/diagram.js`.

## Maintenance

- A form per target of a PostgreSQL connection (13 and later; a standby refuses): VACUUM, ANALYZE, REINDEX
  and CLUSTER of a table or materialized view, an index (REINDEX, CLUSTER by it), a schema (not CLUSTER) or
  the whole database, opened from the explorer (`m`) or the palette (the table on screen, else picked).
- The options the server's version has (PROCESS_TOAST and TABLESPACE from 14, BUFFER_USAGE_LIMIT from 16),
  each one another option rules out disabled with why; VERBOSE and REINDEX CONCURRENTLY on by default;
  CLUSTER's index picked among the valid, whole btree and GiST ones. The exact statement shows as it runs.
- What it locks and for how long in words (a warning when it blocks reads or writes for the whole run):
  the lock by its name, the room a copy needs, the lock queue, the target's size, rows and dead rows.
- Run (`Mod+Enter`) sends the statement alone, outside a transaction block; refused on a read-only
  connection, asked on production. Progress from `pg_stat_progress_*` every 1.5 s and the lock it waits
  for and who holds it; Cancel (`Escape`) is `pg_cancel_backend` of its own session. The server's output
  (VERBOSE) shows when it ends (ADR 0038), with the statistics before and after; `g` reads again (ADR 0293).

Modules: `features/maintenance/`.

## Value search

Looking for a value across a connection's tables, with its limits: [`search.md`](search.md); for an object by its name from the desk's palette: [`palette.md`](palette.md). Text in the source of routines, views and table parts: [`source-search.md`](source-search.md).

## Routines

- A form per signature of a PostgreSQL function or procedure, opened from the explorer (`x` on its row under
  Routines, or Run with its arguments, first in the row's menu) or the palette (a name, then the signature of
  an overloaded one); aggregates, window and trigger functions and those taking `internal` are refused in words.
- A row per argument from `pg_proc` with its mode, type and default, edited by its type's cell editor (ADR
  0287), NULL and DEFAULT as choices (DEFAULT only where one is declared, and an unnamed argument only at
  the end), VARIADIC as the list of its elements, a polymorphic one with the type it is given as; OUT and
  TABLE arguments say they come back as columns. The exact call shows as values change: `SELECT f(...)`,
  `SELECT * FROM f(...)` for a set, a row type or OUT columns, `CALL p(...)` with OUT passed as NULL; named
  notation where arguments have names, every literal quoted and cast to its declared type.
- Volatility decides the guard: a VOLATILE function or any procedure is a write, refused on a read-only
  connection (rolled back too), asked on production, and run for an agent only after the person's yes.
  "Run in a transaction and roll back" sends the call between BEGIN and ROLLBACK; a procedure whose source
  commits or rolls back runs alone and is not offered it.
- Run (`Mod+Enter`) runs the call in the connection's console: its result tabs, notices in Messages, the
  history. The arguments are remembered per connection and routine for the session, never across a restart.

Modules: `features/routines/`.
## Backup and restore

- Back up a PostgreSQL database with `pg_dump` from a form (ADR 0313): format (custom, directory, tar, plain),
  the whole database, schemas or tables, data or schema only, without owners or privileges, compression
  (custom and directory; lz4 and zstd from pg_dump 16), jobs (directory) and INSERTs (plain, on by default so
  the file runs as a script). The save dialog names the file or folder and its grant is asked for there.
- Restore from a file or folder from the open dialog into any PostgreSQL connection's database: clean,
  if-exists, create, data or schema only, without owners or privileges, jobs (not tar), one transaction (one
  job, no create), and the entries `pg_restore --list` reads, filtered and chosen (a list file in the
  plugin's folder). A plain SQL file runs as a script through run-file, on a session. A read-only connection refuses it and
  production is always asked first.
- Both forms show the exact command line, never the password; it goes in `PGPASSWORD` of the program's own
  environment when typed this session, else libpq reads `~/.pgpass`. Each program must be at least the
  server's major version (read through a session) and is found by its own setting (`.pg-dump`,
  `.pg-restore`), on the desk's PATH or in the `path` setting's folders.
- The run has a log panel: the verbose lines as they come, tables written or entries restored, Cancel
  (SIGINT, then SIGKILL), and what came of it with the size written.

Modules: `features/backup/`.

## Agents

- `endue.database.connections` (never a password), `.schema` and `.query` (100 rows a statement by default,
  1000 at most) are registered with an argument schema as agents' tools (ADR 0088); the first two only read.
- An agent's write runs only after the person says yes, whatever the connection's tag and the `confirm`
  setting; a read-only connection refuses it, and an agent is never shown a password prompt.
- `.search-data` answers where a value is in a connection's tables, read-only under the panel's limits.
- `.paste` pastes text into the grid on screen as pending changes, under the same refusals and type checks as
  the person's paste; nothing runs until the person submits.
- `.activity` answers a connection's sessions and who waits for whom, and only reads; `.cancel-session` and
  `.end-session` are irreversible: the core waits for the person's approval, then the plugin asks as it
  asks the person (ADR 0290).
- `.maintenance` opens the form for a connection, schema, table or index and answers the statement, what it
  locks and the size; with `run` it runs after the person's yes and answers the output and the statistics
  before and after (ADR 0293). The server overview can open it with the same arguments.
- The objects feature's commands (`.rename-object`, `.drop-object`, `.edit-source`, `.generate-sql` and the
  rest) take the object by connection, schema, name (and table, for a part); each change shows the person
  its dialog, and `.drop-object` and `.truncate-table` are irreversible (ADR 0312).
- `.routine` opens a function's or procedure's form with its arguments (by name or in order) and answers
  the call and its arguments; with `run` it runs it as above, a write after the person's yes, and answers
  the result's first 50 rows and the notices.
- `.backup` and `.restore` (irreversible) only fill their form: nothing runs until the person submits it.
- `.create-table` and `.change-table` open and fill the table form and answer its script; its run commands are
  not agents' tools, so the person runs it (ADR 0324).

Modules: `agent.js`. More read tools, what agents may reach and their audit list: [`agents.md`](agents.md).
