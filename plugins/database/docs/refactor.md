# The Database plugin's refactorings

A name changed everywhere it is used, in a statement or in the database, with nothing run until the
person has read the script (PG-33). The rest of the plugin is in [`features.md`](features.md); a change to
the refactorings adds its line here.

- The statement at the caret is bound by the parse worker's resolver over the schema cache's model, as
  [navigation](navigate.md) binds it. Every refactoring of a statement replaces it in one edit, which
  Undo takes back. They read PostgreSQL consoles; other engines are told so.
- **Rename** (F2 in the console, Database: rename the name at the caret) asks the new name with the
  palette (a caller can give it as `to`). A name is written as typed and quoted when PostgreSQL needs
  it (`"Big One"`); inside double quotes it is taken as written there.
  - *A name the statement defines*: a CTE, an alias of a FROM item, a select list's output name, a SQL
    routine's parameter. The caret may be on a use or on the definition. Every use the resolver bound
    changes, and nothing in a string or a comment. A FROM item without an alias gains one (`people AS
    who`). A name another CTE, alias or output name of the statement has is refused. A CTE's or a
    subquery's column is renamed in its own query.
  - *An object of the schema*: a table, view, materialized view, sequence, foreign table, column,
    function, procedure, type, domain or schema (Database: rename an object with the script that keeps its
    dependents working takes it by `connection`, `kind`, `schema`, `name`, `table`, `args` too). One
    read-only catalog read gives the object's facts, the routines whose body text names it and
    navigation's dependency catalog rows; then a new console opens holding the script, with nothing run.
    The person runs it there, under the connection's read-only, production and agent guards.
- **The script** says on top, plainly, what it does to each dependent:
  - *Rewritten here*: function and procedure bodies the server keeps as text (PL/pgSQL, a quoted SQL
    body), as `CREATE OR REPLACE` from `pg_get_functiondef` with only the body changed, and how many
    places. They run first, with `SET LOCAL check_function_bodies = off`, and the ALTER last, all in one
    transaction: the routine's header names objects as the server holds them, so the ALTER renames them.
  - *Follow the rename by themselves*: what the dependency catalog records (views, rules, SQL-standard
    bodies, triggers, constraints, policies, defaults), which the server keeps by reference. A view keeps
    the old name of its own column; the header says so.
  - *Check by hand*, with the routine and line: a name in a string (dynamic SQL), a variable or
    parameter of the same name, a qualifier it cannot tell (`r.name` of a record), a bare column where
    another relation the body reads has one of the same name, another overload of a renamed function,
    another schema with an object of the same name, a body in another language, a schema in a routine's
    settings (`search_path`).
  - A body's place changes only when it can name nothing else: a column qualified by its table, an
    alias of it, or NEW and OLD in its own trigger function, or bare in a statement that reads the table;
    a relation, type or function bare or under its schema; a sequence in nextval's, currval's or setval's
    string or cast to regclass; a schema before a dot. At most 200 bodies are read; the header says when
    there were more.
- **Extract into a CTE** (Database: make the subquery at the caret a CTE): a subquery of the statement's
  FROM list, or of a CTE's, becomes a CTE under its alias (with its column names), before the CTE that
  held it or at the end of the WITH list (a new one when there is none). One without an alias asks a
  name. A LATERAL subquery, one inside another subquery, or one that reads a CTE of its own level is
  refused.
- **Inline a CTE** (Database: inline the CTE at the caret where it is used): a CTE used once goes back
  to its use as a subquery under the use's alias (or its own name) and leaves the WITH list. Refused: a
  RECURSIVE list, MATERIALIZED, a column list, a data-modifying CTE, a CTE used twice or not at all.
- **Qualify every name** (Database: qualify every name of the statement at the caret): the schema before
  each relation and routine the resolver bound (pg_catalog's routines stay bare), and in a query the
  FROM item's alias (or name) before each bare column. The columns INSERT, UPDATE, DELETE and MERGE
  write cannot take one, so those statements keep their columns; USING lists and output names stay; a
  column of a relation read twice is left and counted on the status line.
- **Expand `*`** is Database: write out the columns of * at the caret ([`editor.md`](editor.md)).

Code: `ui/refactor/` (`local.js` a statement's own names, `cte.js`, `qualify.js`, `bodies.js` a body's
rewrite, `read-sql.js`, `object.js`, `script.js`, `syntax.js`, `controller.js`), registered by
`ui/features/rename/`.
