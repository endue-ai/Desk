# schema-cache

A PostgreSQL connection's schema, read once and kept (PG-06, ADR 0285). It holds the names, kinds and
row estimates of relations, columns with their types, defaults and keys, constraints (primary, unique,
check, foreign keys with both ends), indexes, triggers, routine signatures (never bodies) and comments;
PG-50's kinds (`../schema/pg/`, ADR 0295), the database level's under the entry `DATABASE` (""), with
the server's databases. Never rows, never secrets. Anything that needs these asks the cache through `catalog.js`, never the
catalog itself; what the cache does not hold answers `undefined`, and the caller reads it as before.

## API (`createSchemaCache({ execute, store, systemSchemas, changed })`, `index.js`)

- `open(conn, quiet?)`: the first use in a session. It answers from the store at once and checks the
  fingerprints behind it; it waits only when nothing is held yet.
- `refresh(conn, { all?, schemas?, quiet? })`: changed schemas by default, `all` reads every chosen
  one, `schemas` reads those whatever their fingerprint. Answers `{ statements, read, database? }`.
- `ran(conn, execution)`: after a run that is not the cache's; a DDL statement starts a quiet check.
- `choose(conn, schemas | null)`, `cancel(connection?)`, `drop(connection)`, `settled(conn)`.
- `view(conn)`: `listed()`, `schemas()`, `chosen(s)`, `held(s)`, `kept(s)`, `objects(s)`,
  `columns(s, t)`, `parts(s, t)`, `foreignKeys(s, t)`, `routines(s)`, `comment(s, t)`, `status`, `readAt`.

## How

- `kinds.js`: one reader per kind, `{ id, label, marks, level?, sql(schemas, version) }`; PG-50's come
  from `../schema/pg/index.js`. A database-level kind is read only when the row "" of the fingerprint
  moved. A new kind's `marks` join the fingerprint and the stored cache of the old kinds is read again.
- `pass.js`: one fingerprint statement, then one statement per kind for all the schemas it reads,
  each a `catalog: true` run of `execute` (PG-01c moves it to core sessions). Cancel lands between.
- Fingerprint: per schema, the namespace's `xmin` and the count and sum of `xmin` of its rows in
  pg_class, pg_attribute, pg_attrdef, pg_type, pg_constraint, pg_index, pg_trigger, pg_proc and
  pg_description. DDL writes new row versions; ANALYZE and VACUUM do not, so they read nothing. A
  table renamed under another schema's foreign key reads that schema again in the same pass.
- `store.js`: an index `schema-cache.<id>` and JSON text chunks `schema-cache.<id>.<n>` of at most
  60 KiB, 16 a database (about 960 KiB); past the cap a schema is held for the session only ("not
  kept"). Another database (ADR 0321) is `<id>.d-<hash>`, listed in `schema-cache.<id>.databases`.
- `model.js` turns rows into what `view.js` answers; `view.js` also has the explorer's labels.

## Test

`pnpm exec vitest run plugins/database/tests/schema-cache-*`; the live file needs
`ENDUE_DB_TEST_POSTGRES` set to a scratch database's URI.
