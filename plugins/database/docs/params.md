# Parameters and the check without running

How a console's parameters reach the server, and how a statement is checked without running it
(PG-21, ADR 0353). The rest of the plugin is in [`features.md`](features.md).

## Parameters

- A statement's `:name`, `$1` (PostgreSQL) and `?` (MySQL, SQLite) are asked for before it runs, each
  name once, and the answers are remembered for the console this session.
- On PostgreSQL the values are bound: the placeholders go as `$1..$n` in the order of first use and the
  values beside the text, as text or NULL, with the types the server inferred. No value is ever part
  of the SQL, so quotes, `;`, comments and anything shaped like an injection are stored as text.
- Before the prompts the server is asked, without running anything, what the statement takes: each
  prompt names the type (`Value for :id (integer)`). A value that does not fit an integer, numeric,
  float, boolean, uuid or json type is refused and asked again with the reason; any other type is
  judged by the server, which refuses a value before the statement runs.
- `NULL` (any case) is NULL; `='NULL'` is the string. An answer written `=expression` (`=now()`) is put
  in as SQL, and the status line says which parameters were sent as SQL.
- A statement that does not parse is asked about without types, and its run shows the error.
- A console result with bound values is not offered pages; Load more runs it again with the values.
- MySQL and SQLite run through their client programs and still fill the values in as literals.

## Check without running

- Database: check the statement without running it asks the server about the statement at the caret,
  or each one the selection holds: PostgreSQL's Parse and Describe, never Bind or Execute, so nothing
  runs and nothing changes, on a read-only connection too.
- The console shows a row for each parameter (its name and the type the server infers) and each column
  the statement answers (name and type); the status line says it in one line. A statement that answers
  no rows (an INSERT without RETURNING) says so.
- The server's error comes with its position, and the caret moves there, in the text as written
  (`:name` and all).
- It runs on the console's session, so the session's temporary tables and search_path count; inside an
  open transaction it runs under a savepoint, so a statement that does not parse leaves the transaction
  as it was.
- It is the plugin's one check without running: the parameter prompts and the agents'
  `check-statement` (`agents.md`) use the same path, which also answers parameter types and columns.
