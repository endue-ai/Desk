# Database objects in the desk's palette

A table, a column or a routine is opened by typing part of its name anywhere in the desk. The rest of
the plugin is in [`features.md`](features.md); a change to what the palette finds adds its line here.

- The plugin is a palette provider (`contributes.paletteProviders`): from two typed characters the
  palette asks Database: find objects, and lists its answers under Database objects, after the commands.
- It finds tables, views, materialized views, foreign tables, functions, procedures, types, schemas and
  columns of every PostgreSQL connection, on each database of its server whose schema cache was kept
  (PG-13). A cache read this session answers from memory; one that was not is read once from the
  plugin's store. No server is asked, so what was never read is not found: Database: read the schema
  again reads a connection's.
- Matching is the palette's own: the characters in order, word starts and runs counting more, a name
  holding the query whole first, the name a row shows before its qualified name (`public.orders`,
  `public.orders.id`). Ties go tables, views, routines, types, schemas, then columns.
- Each row shows the name (a routine with its arguments) and its kind, schema and connection,
  `Shop/analytics` for another database of the server.
- Enter opens it: a relation's rows, a column's table's rows, a routine's source, a type's DDL, a console
  on a schema's database. Mod+Enter shows a relation's or a routine's DDL and copies a column's, a type's
  or a schema's qualified name; the last action always copies the name, every part quoted.
- Database: hide a connection from the palette, or show it again, leaves a connection out, on every
  database of its server, until it is run again; the list is kept in the plugin's store.
- A hundred thousand names answer a query in a few milliseconds: a schema's names are made once per read
  of it, and only the best few are kept as they are found.

Modules: `features/palette/`.
