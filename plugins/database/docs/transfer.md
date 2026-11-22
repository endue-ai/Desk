# The Database plugin's copy between databases

How a PostgreSQL table, several tables or a query's result are copied to another connection, database or schema
(PG-63). A change to it adds its line here.

- Database: copy tables to another database copies the table on screen, a table picked, or every table of a
  schema (or the tables an agent names). Database: copy the query's result into a table copies what the console's
  statement answers (the selection, else the statement at the caret).
- The form asks where to: a PostgreSQL connection (a read-only one cannot be chosen), its database (another
  database on the same server and sign-in), the schema, the name (one table's, or the result's table), and what:
  structure and data, structure only, or data only into tables already there, with or without foreign keys; for a
  query, a new table or an append to one already there.
- Nothing runs from the form. Both sides are read (the source's catalog, the target's version, types, schemas and
  tables) and the copy's panel shows the report and the script the target's side will run. A problem holds the
  copy: a type the target lacks, a table already there for a structure copy, a table or a column missing for a
  data copy, two result columns into one. A note is said and the copy may start: an older target server, a schema
  that is created, a column of another type (each value is read as the target's), a partitioned or foreign table
  that becomes a plain one, triggers that are not copied.
- An append maps each result column to a target column by name; the panel's selects change it or leave a column
  out, and the report and the script follow.
- Start the copy runs it; a production target asks first, naming the tables. The target's side is one
  transaction on a session of its own: BEGIN, the schema and the structure (keys, checks, indexes, a serial's
  sequence made for the target), each table's `COPY ... FROM STDIN` in the order its foreign keys need (a
  referenced table first), the foreign keys, the sequences set past the copied values, COMMIT. Any failure, or
  Cancel, rolls all of it back; both sessions close at the end.
- Rows stream: each table's `COPY (SELECT columns FROM table) TO STDOUT` on the source feeds the target's COPY
  through a pipe of one chunk of 1 MiB at most (`copy/index.js`, ADR 0356), in COPY's text format, which every
  server version reads, with the same column list on both sides (generated columns are left out: the target makes
  them). Several tables read in one REPEATABLE READ READ ONLY transaction of the source, so they are one snapshot.
- The panel shows each table's bytes as they go and its rows at the end, then the rows copied and the time.
- Names: a table copied under another name gives its keys, indexes and sequences the new name in place of the old
  one at their start (`items_pkey` becomes `stock_pkey`), or before them; a foreign key to a table copied with it
  points at the copy, one to another table at that table's name on the target.
- Commands: `.transfer`, `.transfer-query`, `.transfer-start`, `.transfer-cancel`. An agent's call only opens the
  form and the panel: the person starts the copy.
- Code: `ui/transfer/` (`choose.js`, `read.js`, `ddl.js`, `order.js`, `compare.js`, `plan.js`, `pipe.js`, `run.js`,
  `controller.js`, `form.js`, `panel.js`, `state.js`), `ui/features/transfer/`.
