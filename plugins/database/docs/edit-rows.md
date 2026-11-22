# The Database plugin's edits of joins, tables without a key and views

Which rows a cell of a PostgreSQL result changes (PG-45, ADR 0350). The rest of editing is in
[`features.md`](features.md) under Editing (ADR 0115); a change to this mapping adds its line here.

- The server says each result column's table and column (the row description's table OID and column
  number), so a result is mapped column by column, never by reading the statement: a console's join, a
  subquery, a view. The tables are read by OID from `pg_catalog` at the first edit (their columns, keys,
  foreign keys and what the server can change of them), not from the schema cache, which may be older.
- A table's cells change when its rows can be told apart in the result, in this order: its primary key; a
  unique index that is not partial, has no expressions and whose columns are all NOT NULL; its `ctid` when
  the result selects it (`SELECT ctid, * FROM t`, an ordinary table only); every one of its columns. Else its
  cells say what to add. A table's view of a table without a key reads no `ctid`, so it is keyed by every
  column.
- A change keyed by `ctid` or by every column must change exactly one row: its statement counts the rows it
  changed and fails otherwise, so the whole Submit rolls back. It says whether the row moved (a row's `ctid`
  changes on every update and on VACUUM FULL; read the rows again) or matched two or more equal rows (select
  a key or `ctid`). Values are compared as the server writes them.
- A cell that cannot change says why in the value viewer (Enter) and when it is set to NULL (`n`): an
  expression, a column in the result twice, a table whose key is missing, a materialized view, a view the
  server cannot update, a column a view computes, and a table the statement reads more than once (a self-join,
  a subquery or a WITH query over the same table), since which of its rows a column shows is not certain.
- One Submit is one transaction. A join's row changes as one UPDATE per table, each keyed on its own key; two
  rows of the join that are one row of a table are one statement, and two values for one of its cells are
  refused. Updates run parents first (a table another one of the result references comes before it); a
  foreign key that holds against the changes in any order is the server's refusal, said with both tables.
- A join takes no new or deleted rows. One table or view takes them as the server allows
  (`pg_relation_is_updatable`).
- Only a statement that reads (SELECT, TABLE, VALUES, WITH without a write) is mapped, so reading its rows
  again after Submit writes nothing. MySQL, SQLite and a PostgreSQL result without origins keep the plain
  one-table SELECT of ADR 0115.

Modules: `edit/origins.js` (the catalog read), `edit/origin-target.js` (the mapping), `edit/tables.js` (the
statements), `edit/source.js` (`readsOnly`, `repeatedNames`), `edits.js`.
