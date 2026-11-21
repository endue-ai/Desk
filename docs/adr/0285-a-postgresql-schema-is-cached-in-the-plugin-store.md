---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# A PostgreSQL schema is cached in the plugin's store and refreshed by catalog fingerprints

## Context and Problem Statement

`endue.database` reads the catalog lazily: a node reads its children when it opens, autocomplete reads
the tables and columns it needs, the ER diagram reads its schema again, and all of it is gone at the
next start. On a schema of thousands of tables every start pays for it again, and a node opened twice
in different places asks the server twice. The PostgreSQL plan (#438) builds on the schema: join
completion, the ER diagram, find in the schema, schema compare and the agents' context (PG-30 to
PG-33, PG-53, PG-80, PG-82, PG-103). Where is the schema kept between runs, how is it known to be
current without reading it again, and what is never kept?

## Decision Drivers

* Read once: a bounded number of statements whatever the size, with progress and Cancel
* Correct after another session changes the schema, cheap when nothing changed
* Survives a restart, with no new permission and no new bridge method (the brief: spec first)
* Never rows and never secrets; a bounded size, and a stated rule past it
* Moves with the engine to the core's sessions (PG-01c, ADR 0281) without a rewrite
* New kinds of object (PG-50) added without touching the pass or the storage

## Considered Options

* Where: the plugin's own store (`store.get`, `store.set`), as chunks of compact JSON text
* Where: a file under the plugin's folder through `fs.write`
* Where: a new core method (`cache.*` or a table in the core's own database)
* Where: the frame's IndexedDB
* Where: memory only, as today
* Fresh: per-schema fingerprints from the catalog's `xmin`, read on connect and on refresh
* Fresh: event triggers that record DDL in a table of ours
* Fresh: a digest (`md5`) of the catalog rows, or a time to live

## Decision Outcome

Chosen options: "the plugin's own store, as chunks of compact JSON text" and "per-schema fingerprints
from `xmin`", because the store needs no grant and is already what plugins keep their state in, and the
fingerprint is one statement that answers per schema whether anything a kind reads was written.

**Pass.** One fingerprint statement, then one statement per kind (relations, columns, constraints,
indexes, triggers, routine signatures) for every schema to read: seven statements for ten tables or ten
thousand. Each is a `catalog: true` run of the plugin's `execute`, so progress shows between steps and
Cancel lands before the next. A statement answering more than 500,000 rows is an error asking to choose
fewer schemas. System schemas are left out unless the person chooses them.

**Fingerprint.** Per schema: the namespace's own `xmin`, then the count and sum of `xmin` of its rows in
pg_class, pg_attribute, pg_attrdef, pg_type, pg_constraint, pg_index, pg_trigger, pg_proc and
pg_description. DDL writes new row versions; ANALYZE and VACUUM update in place, and freezing keeps
`xmin` (since 9.4), so they read nothing. A schema is read again when its mark moved, when the person
asks for it (`g`) or reads everything again (Database: read the schema again). A table renamed under a
foreign key of another schema moves only its own schema's mark, so a pass that finds such a key reads
the other schema too. A DDL statement run from the plugin starts a quiet check; one run by anyone
else is found at the next connect or refresh.

**Storage.** An index `schema-cache.<connection>` (version, the server it was read from as engine, host,
port, database and user, the kinds, the chosen schemas) and chunks `schema-cache.<connection>.<n>` of
at most 60 KiB of compact JSON text, at most 16 a connection (about 960 KiB). Text and not nested JSON:
the core writes its store file pretty-printed, where every array item takes a line. Each chunk names
its schema, read time and part, so one left by an interrupted write is not read; a cache of another
server, version or set of kinds is read again. Only names, types, definitions (`pg_get_*def`) and
comments are kept; never rows, never routine bodies, never a password. Past the cap a whole schema
(public first, then by name) is held for the session only, shown as "not kept", and read again at the
next start; nothing is half-kept.

**Other engines** keep reading a node when it opens (unchanged): their catalogs have no `xmin`, and
PostgreSQL is where the plan needs the cache.

### Measured

PostgreSQL 17.12 under load average 135 (other work on the machine): a schema of 10,000 tables of ten
columns, in a database of 40,419 pg_class and 283,146 pg_attribute rows. The fingerprint statement took
97 to 210 ms warm (617 ms cold); the columns statement 1.4 s for 100,000 rows (2.7 MB of CSV), the
others under 0.6 s each. That schema's 4.5 MB of rows is past the cap: it is held, not kept.

### Consequences

* Good, because a restart answers the explorer and completion from the store at once and asks the
  server one statement to know it is current.
* Good, because consumers read one API (`plugins/database/ui/schema-cache/README.md`) and never the
  catalog for what it holds; a new kind is one entry in `kinds.js`.
* Good, because the pass runs through `execute`, so PG-01c moves it onto core sessions unchanged.
* Bad, because the core rewrites the whole store file on every `store.set`: a pass writes only the
  chunks that changed, but a store with many cached connections is a file of several MiB.
* Bad, because a schema past about 960 KiB of catalog rows is read again at every start; a cache in
  the core (a later ADR, once sessions live there) would lift the cap.
* Bad, because a type renamed in another schema shows under its old name in the columns using it until
  their schema is read again.

## More Information

Issue #446 (PG-06), epic #438; ADR 0038 (clients), ADR 0281 (core sessions). Code:
`plugins/database/ui/schema-cache/`; tests: `plugins/database/tests/schema-cache-*.test.ts`.
