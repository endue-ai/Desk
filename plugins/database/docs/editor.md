# The Database plugin's SQL editor

What the console's editor does with the SQL in it, beside running it. The rest of the plugin is in
[`features.md`](features.md); a change to the editor adds its line here.

## Format SQL

- `Mod+Shift+F` and Database: format the SQL lay out the selection, else the whole console; Database:
  format the statement at the caret the selection, else that statement. Only space and the case of
  keywords change.
- PostgreSQL is laid out from its own scanner and parse tree, in the parse worker (ADR 0292): each clause
  on its line, a list one item a line when it does not fit, conditions broken at AND and OR, joins on
  their lines, subqueries, CASE and brackets indented when they break. Comments stay where they were, a
  statement a line apart. Each laid-out statement is parsed again, and kept as written unless its tree is
  the same. A statement that does not parse, or a routine with a BEGIN ATOMIC body, is left as written,
  and the status line says which.
- The style is eight settings: `format-keyword-case` (upper, lower, preserve; a keyword the grammar reads
  as a name keeps its spelling, and a type is written in lower case unless preserve), `format-indent`
  (1 to 8), `format-line-width` (40 to 240), `format-comma` (last, first), `format-and-or` (before, after),
  `format-joins` (flat, indented), `format-one-line` (clause, statement, item) and `format-lists` (indent,
  align). A change applies at the next Format, without a restart.
- MySQL and SQLite keep the format that reads tokens alone: each clause on its line, the select list one item
  a line, reserved words in capitals, by none of the settings.
- `format-on-save` (off by default): Save lays a `.sql` file's console out before it writes the file, by
  the format of the file's connection, and says a statement it left as written; a file on no connection
  yet is written as typed.

Modules: `sql/layout/`, `console-run.js`, `console-files.js`.

## SQL problems

- A PostgreSQL console underlines what the server would refuse, 300 ms after typing stops (ADR 0294): a
  statement the parser cannot read, at the token PostgreSQL's own grammar names, and a table, view, sequence,
  column or schema the schema cache does not have, with the message the server would give and the search path
  it looked in. Also an ambiguous column, a FROM entry used where it is not visible, a select-list alias used
  in WHERE, and an INSERT whose columns and values do not match. A hint names the nearest name, or the schemas
  off the path that hold it.
- The check runs in the parse worker and parses again only the statements that changed. SET search_path,
  set_config, and the tables, columns and schemas the script creates, renames or moves count for the statements
  after them.
- Nothing is told where the cache cannot tell: a schema it did not read, a function, after DO, CALL or CREATE
  EXTENSION, psql's meta-commands and `:name` and `?` statements. The catalog is never queried for it. A partition
  the cache read under its root table is a relation with the root's columns. Once a statement runs, the server's
  answer replaces the check's until its text changes.
- The underline, a mark in the gutter and the message on hover. `F8` and `Shift+F8` go to the next and previous
  problem and say it on the status line; `Mod+.` opens the list (Database: list the SQL problems), read by a
  screen reader. `problems-syntax` and `problems-names` turn each kind off. MySQL and SQLite consoles are not
  checked.

Modules: `diagnose/`, `features/problems/`, `sql/parse/`, `view-editor.js`.

## SQL warnings

- Beside the problems, a PostgreSQL console marks statements the server runs that are likely mistakes, as
  warnings (ADR 0328), each with its identifier under the message: `null-comparison` (`= NULL`, `<> NULL`,
  `CASE x WHEN NULL`), `join-without-condition` (tables side by side that no condition links, `ON true`, a
  NATURAL JOIN with no column in common), `select-star` (in a view or an INSERT ... SELECT), `column-cast`
  (a column the server casts to compare it), `not-in-null` (NOT IN over a NULL or a nullable column),
  `update-without-where`, `delete-without-where`, `limit-without-order`, `function-on-indexed-column`,
  `insert-without-columns` and `server-signal` (`pg_cancel_backend`, `pg_terminate_backend`).
- What needs the schema (types, NOT NULL, indexes) is read from the schema cache only, and nothing is said
  where it cannot tell.
- A fix only where the rewrite is certain: `IS NULL` and `IS NOT NULL`, and an INSERT's column list from the
  cached columns. It is the message's button, a key in the list (`Mod+.`), and Database: fix the SQL warning
  at the caret; a fix whose text changed since the check is refused.
- `problems-warnings` turns them all off and `problems-warnings-off` lists identifiers to leave out.
  `-- endue-ignore [identifiers]` turns them off for its line, or for the next line when it stands alone.
  A statement that ran keeps its warnings; the run's confirmations are unchanged.
- A console statement that calls `pg_cancel_backend` or `pg_terminate_backend` runs as a change: a read-only
  connection refuses it, production and agents ask first.

Modules: `diagnose/warnings.js`, `diagnose/warn-*.js`, `diagnose/ignore.js`, `sql/classify.js`.

