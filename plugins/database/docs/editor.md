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

## PL/pgSQL bodies

- Inside the dollar quotes of `CREATE FUNCTION` and `CREATE PROCEDURE` with `LANGUAGE plpgsql` (before or after
  `AS`), and of `DO`, the body is drawn as PL/pgSQL (ADR 0343): its keywords and SQL's, declared variables and
  parameters (`tok-variable`), strings, numbers and comments, `$1` as a parameter. DECLARE folds to BEGIN, and
  BEGIN, IF, LOOP, WHILE, FOR and CASE fold to their END. A body in another language, a `BEGIN ATOMIC` body
  and a single-quoted body stay one string.
- The problems check parses the routine with PostgreSQL's own PL/pgSQL grammar in the parse worker (the SQL
  inside with the server's grammar too): a syntax error is underlined on its token with the grammar's
  message and its line of the body; the grammar gives no position, so the statement is found by parsing the
  body cut after each `;` with its open blocks closed. A routine that parses is told a name used where only
  a variable can stand (an expression, a SELECT with no FROM) that nothing declares, in the words the server
  uses when the line runs; and two warnings, `unused-variable` and `unreachable-code` (after RETURN, RAISE
  EXCEPTION, or EXIT and CONTINUE without WHEN). A name declared in any block counts as declared.
- Completion inside a body offers the variables declared before the caret in a block around it, the
  routine's parameters, a `%ROWTYPE` record's fields after `r.`, PL/pgSQL's statement words where a statement
  starts, and in the SQL inside (SELECT ... INTO, PERFORM, RETURN QUERY, a FOR loop's query, an expression)
  what any query is offered. It needs no schema cache for the variables.
- A routine's source opened from the explorer (`s`, Database: edit the source) is such a console: it is
  applied as `CREATE OR REPLACE`, and the server's error selects its line.

Modules: `sql/plpgsql/`, `editor/plpgsql.js`, `editor/plpgsql-complete.js`, `diagnose/plpgsql*.js`.

## Completion

- The list opens after `.`, two letters of a name, or INSERT's `(` after its table, and on `Ctrl+Space`. In a
  PostgreSQL console with a schema cache it is worked out in the parse worker (ADR 0327): the statement at the
  caret is parsed by PostgreSQL's grammar and bound by the same resolver as the problems check, over what the
  cache holds and what the script before the statement did (SET search_path, the tables it created). A statement
  that does not parse yet is mended for it (its tail cut back, parentheses closed, a JOIN given its ON); when it
  cannot be, the FROM items are read from the tokens. Nothing is asked of the server. MySQL, SQLite and a
  connection whose cache lists nothing yet complete on the page from the catalog.
- After JOIN, the tables a foreign key links to the tables before it come first, one candidate per key and both
  ways; taking one writes its ON condition (`orders on orders.customer_id = c.id`), all columns of a key of two
  or more. The condition names the joined table, or an alias made of its initials when that name is taken (a
  key to the table itself). A table already in FROM is not offered again; CROSS and NATURAL joins get none.
- INSERT INTO t ( offers every column with a VALUES row of tab stops, and the columns without a default (an
  identity column cannot be told from the cache and is listed); VALUES ( offers a row for the columns listed.
  `Ctrl+Space` after `*` in a select list, or Database: write out the columns of * at the caret, writes the
  columns of every FROM item in reach (qualified when more than one), or of `t.*`'s alone.
- Columns come from every level in reach: the nearest FROM first, then the queries around a correlated subquery;
  CTEs, subquery aliases and set-returning functions (a function's TABLE or SETOF result, a scalar one under its
  alias) with theirs. A candidate shows its type or kind beside it and its comment in the info box; a name that
  needs quotes is quoted (PostgreSQL's reserved words, and any name that does not read back the same).
- Order: the word's match (whole, start, then inside from three letters), then scope (joins, lists and `*`; the
  nearest columns; outer ones; FROM names and CTEs; tables; schemas; functions and types; snippets; keywords),
  then the type a slot expects (the other side of `=`, a function's argument, SET's column, a VALUES slot), then
  the person's picks: how often and how lately each candidate was picked, kept in the plugin's store under
  `completion-picks` (200 at most, the oldest first to go), then the name.
- Snippets: `sel`, `selc`, `ins`, `upd`, `del`, `upsert`, `with`, `ctab`, `idx`, `txn` where a statement starts,
  `case` in an expression, each in the console's dialect; Tab and Shift+Tab move between the places to fill. The
  `snippets` setting adds the person's own (a name to a template, `${name}` a place to fill; at most 100, 4000
  characters each), offered in both places; one named like a built-in replaces it.
- Signature help: typing `(` after a function or `,` inside a call shows its overloads over the `(`, from the cache
  or PostgreSQL's built-in functions, the argument at the caret in bold and the first overload that takes it.
  `Ctrl+Shift+Space` and Database: show the arguments of the function at the caret open it; `ArrowUp` and
  `ArrowDown` step through the overloads while the list is closed; it closes on `Escape`, on the `)` that ends the
  call or when the caret leaves it.
- On a 1 MB script, a completion parses the statement at the caret alone and replays the check's state before it:
  about 4 ms in the worker; the page only sends the statement.

Modules: `editor/` (`complete.js`, `caret.js`, `statement.js`, `rank.js`, `joins.js`, `lists.js`, `snippets.js`,
`signatures.js`, `completion.js`, `signature-help.js`), `features/completion/`, `diagnose/check.js`, `sql/parse/`.
