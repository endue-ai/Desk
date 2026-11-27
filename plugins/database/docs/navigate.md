# The Database plugin's navigation from a name

From a name in a PostgreSQL console to what it means, without leaving the keyboard (PG-32). The rest of
the plugin is in [`features.md`](features.md); a change to navigation adds its line here.

- The statement around the caret is bound by the parse worker's resolver (`ui/sql/parse/`, PG-05) over the
  schema cache's model, the one completion and the SQL problems use, with the server's default search
  path. Only the statement is sent, so a large script costs what its statement does. A type is not bound
  by the resolver: the word at the caret is looked up among the cached types (`1::positive`).
- **Go to definition** (F12, Database: go to the definition of the name at the caret): on a CTE, an alias
  (`FROM people p`, `AS p`, a subquery's), a CTE's column or an ORDER BY output name, the caret moves to
  where the statement defines it and selects the name. On a table, view, sequence, column, function,
  procedure or type it opens the object's DDL view (a column's table's; a routine with overloads asks
  which). A schema has no DDL and says so.
- **The card**: resting the pointer on a name for 400 ms, or Alt+F12 at the caret (Database: show what the
  name at the caret is), shows what the schema cache holds, with nothing asked of the server: a relation's
  kind, comment, row estimate, columns with their types, keys and defaults (at most 24, the rest counted)
  and its primary, unique and foreign keys; a routine's overloads with their results and comments; a
  column's type, NOT NULL, default and comment; a type's kind; an alias's is its relation's. Escape or a
  move of the caret closes it.
- **Find usages** (Shift+F12, Database: find the usages of the name at the caret) opens a panel per name.
  - *From the server's dependency catalog* (`catalog`): one read-only catalog read of `pg_depend` gives
    the views and rules (through their rewrite rules), routines with SQL-standard bodies, triggers (not the
    internal ones of a foreign key), foreign keys and checks, policies and column defaults that depend on
    the object, a column's own or a routine's every overload. At most 500 rows; the panel says when it was cut.
  - *From parsed source* (`parsed`): routine bodies the catalog does not record (PL/pgSQL, a quoted SQL
    body) whose text holds the name, at most 200, read with the plugin's lexer, so a name in a string or a
    comment does not count and `other.people` is another schema's; past 64 KiB of bodies the scan runs in
    a worker of its own. A routine the catalog lists is not listed again. Then every open console of the
    connection (and the .sql file it is bound to, named by its path), bound by the resolver, one row per
    place. A .sql file that is not open in a console is not read.
  - A row opens what it names: an object's DDL (a trigger's, policy's or key's table's), a routine's
    definition, or its console with the name selected.
- Other engines are told that navigation reads PostgreSQL consoles. A CTE's or an alias's usages are not
  listed: F12 goes to its one definition.

Code: `ui/navigate/` (`target.js` the name at the caret, `card.js` and `card-view.js`, `usages-sql.js`,
`mentions.js` with its worker, `find.js`, `usages-panel.js`, `editor.js` the keys and the hover,
`controller.js`), registered by `ui/features/navigate/`.
