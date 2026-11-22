# Searching the source of routines, views and table parts

Every routine, view or table part that mentions a column, a table or a phrase, found in one search.
The rest of the plugin is in [`features.md`](features.md); a change to the source search adds its
line here.

- Database: search the source of routines, views and triggers opens a panel per PostgreSQL connection:
  the text to find, as typed or as a regular expression (the page's own engine, within one line),
  ignoring case (on by default), comments too, where to look (this schema, this database, or every
  connection and each cached database of its server) and the kinds of object: functions, procedures,
  views, materialized views, triggers, policies, checks and defaults.
- It reads what the schema cache holds (PG-06): triggers, policies, checks and defaults as they are,
  never asking the server. The cache keeps no routine or view bodies, so those are read with the same
  reads their source console uses (`pg_get_functiondef` in batches by oid, `pg_get_viewdef` per
  schema), as catalog runs that ask for nothing, and kept for the session until the cache reads that
  schema again. A connection whose bodies cannot be read is searched in what is cached and said so.
- Each object's text is the one its console shows (`CREATE OR REPLACE FUNCTION ...`, `CREATE OR
  REPLACE VIEW ... AS`, the part's DDL), so a line number is the console's line. A default is matched
  in its expression and a comment in its text, never in the statement's own words around them.
- Comments, as an option: the COMMENT ON texts of tables, views, columns and routines become objects
  of their own, and matches inside `--` and `/* */` comments of a definition count. Off, both are
  left out (a string's `--` is never a comment).
- Schemas are searched one after another with progress; Cancel (or Escape) stops the read in flight
  and every schema after it. Texts of 64 KiB or more are matched in a worker, off the frame's thread.
- Results list each object with its kind, connection, schema and table, and its matching lines with
  each match marked: at most 50 lines an object and 2,000 in all, the counts going on. A line opens a
  routine's or a view's source console (Database: edit the source) or a part's DDL, with that line
  selected.
- `endue.database.search-source` with a `text` answers the objects and their first lines for agents,
  read-only; `.search-source-cancel` stops it. Nothing is replaced here: a rename has its own command.

Modules: `features/source-search/`, the palette's `sources.js` for every connection's caches.
