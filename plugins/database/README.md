# plugins/database

`endue.database`, a database client for PostgreSQL, MySQL / MariaDB and SQLite, in the community folder
format and on the public SDK only. The explorer lists connections, schemas and every object kind (tables,
views, materialized views, sequences, routines, events; a table's columns, keys, foreign keys, indexes and
triggers) with a filter, row counts and each object's DDL. A console has highlighting, autocomplete from the
schema, Format SQL and parameters; results sort, filter, page, transpose to a record, open a value viewer,
copy and export. Grid edits are pending changes applied in one transaction (ADR 0115). A schema's ER
diagram is drawn from its foreign keys; connections take a group and a colour. `Mod+Shift+B` opens
it; every operation is a command (`endue.database.*`); `.connections`, `.schema` and `.query` serve agents.
Drag and drop (ADR 0119): a `.sql` file opens in a console; a `.csv`, `.tsv` or `.json` file opens an import (the table it landed
on or one named like it, a column mapping, a preview, every INSERT in one transaction, 512 KiB of SQL at most), read with `fs.read`
asked for once. Rows drag `db/rows` `{ connection, engine, schema?, table?, columns, rows }`, INSERT (`desk/text`) and TSV (`text/plain`); a table drags its qualified name.

It runs each engine's own client through `proc.spawn`, never a shell, each in a mode that cannot reach past
the database (ADR 0038): `psql -X -w`, a `-c` per statement; `mysql --binary-mode --local-infile=0`;
`sqlite3 -safe`. Markers split the output per statement and keep NULL, `''` and `'NULL'` apart. Passwords
are never kept: `~/.pgpass` and `~/.my.cnf` work, else the person types one per session. Read-only
connections refuse writes and edits before the client starts; production writes and agents' writes ask.

| Permission | Why |
| --- | --- |
| `proc:spawn` (`psql`, `mysql`, `mariadb`, `sqlite3`) | Run the engines' clients, and only them |
| `fs:write` (`${home}/Downloads/**`) | Export a result to a file there |
| `cmd:invoke` (`desk.palette.pick`, `desk.buffers.*`, `desk.files.reveal`) | Ask, be a buffer, show an export |

| Files | Purpose |
| --- | --- |
| `ui/sql/`, `ui/editor/`, `ui/engines/`, `ui/schema/` | Lexer, statements, quoting; highlighting, completion, format, parameters; per engine: client arguments and output, objects, parts and DDL |
| `ui/edit/`, `ui/edits.js` | Pending changes, their SQL and the one transaction they run in |
| `ui/explain/`, `export.js`, `results.js`, `run.js`, `clients.js`, `execute.js`, `catalog.js` | Plan trees; copy and export formats; processes, clients, checks before a run, the catalog |
| `ui/consoles.js`, `console-run.js`, `pages.js`, `tools.js` | Consoles, runs, paging, history and stars, DDL |
| `ui/database.js`, `commands.js`, `view*.js`, `keys.js`, `*.css` | Controller, commands, DOM, keys, the look |
| `ui/drops.js`, `dropped.js`, `dnd.js`, `import*.js` | What a drop does and carries out, what rows and tables drag, the import |

```bash
pnpm exec vitest run plugins/database
ENDUE_DB_TEST_POSTGRES=postgresql://... ENDUE_DB_TEST_MYSQL=mysql://... pnpm exec vitest run plugins/database/tests/live.test.ts
cargo run -p desk-cli -- plugin validate plugins/database
```
