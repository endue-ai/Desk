---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# A PostgreSQL connection reaches every database of its server, each under a reference of its own

## Context and Problem Statement

A PostgreSQL session is bound to one database: what another database holds can be read only by
signing in to it. Until now a `endue.database` connection named one database, and a person who
wanted a second database of the same server added the connection again, with its password, its
history and its tag, and kept the copies alike by hand. Issue #450 (PG-13) asks that one connection
show every database of its server that its role may use, open any of them with the same
credentials, and let a console or a table view say which one it is on and switch. How does the
plugin name the connection on another database, so that what it reads, runs, keeps and drops goes
to the right database, and what stays the connection's?

## Decision Drivers

* No feature may run on the wrong database: a DDL statement from the explorer, a row edit, a
  maintenance form or an agent's query must reach the database its row or console is on
* The password, the keychain entry (ADR 0311), the history and the starred queries stay one per
  connection, as the person sees it
* Another database costs nothing until the person opens it: no session and no statement before
* The schema cache (ADR 0285) stays per database, since its fingerprints and what it holds are
* A database that refuses breaks nothing else
* No change to `specs/`: sessions already open on any database a connection's host allows

## Considered Options

* A reference per database: the connection with `database` replaced, its id `<id>/<database>`,
  resolved by the connection manager wherever a connection is looked up
* A `database` field on every explorer row, console and command, passed down to each run
* A saved connection per database, made on first use and linked to the original

## Decision Outcome

Chosen option: "a reference per database", because every feature already finds its connection
through `manager.get(id)` (or `deps.connection(id)`) before it runs: when the id a row or a console
holds names a database, the connection it gets is already on that database, and a feature written
before this change runs there without knowing. A field on every row would have to be threaded
through each feature, and one that forgets it runs DDL on the connection's own database without an
error. Saved copies are what the person did by hand, with the same drift.

**The reference.** A connection id never holds a slash (`[a-z0-9-]`), so `<id>/<database>` cannot
clash. `onDatabase(conn, database)` (`ui/databases.js`) answers the connection itself on its own
database (or none named), else a copy with `database`, that id, the name `<name>/<database>` and a
link `home` to the connection. Editing, duplicating, removing and disconnecting act on `home`.

**Per connection, per database.** The password (in memory and the keychain's `passwordRef`), the
history and the starred queries are kept under the id before the slash; each history entry and
starred query of a PostgreSQL connection records the database it ran on. The explorer's rows and the
schema cache key by the whole reference; the cache's store keys for another database are
`<id>.d-<hash of its name>` (store keys allow no slash), listed under `schema-cache.<id>.databases`
so removing the connection removes them.

**The list.** The schema cache's server reader (`ui/schema/pg/server.js`, ADR 0295) already reads
roles and tablespaces; it also reads `pg_database` rows that allow connections and on which the role
has `CONNECT`, a template marked so, and its fingerprint covers them. The explorer lists them under
the connection, the connection's own first and open, the others by name, closed and unread; a
template shows only with the system-schemas setting. Opening one reads its schemas with the
connection's credentials; a refusal fails that row alone, with the server's words under it.

**Switching.** `Database: switch the database` and the header's database button move the console or
table view on screen to another database of its server: pending grid changes are asked about first,
a console keeps its id and text, a table view reads the same table there. A console opened on
another database takes a console id of its own. Agents' `.schema` and `.query` take an optional
`database`; `.schema` without a schema also answers the server's databases.

### Consequences

* Good, because no feature can run on another database than the one its row or console shows
* Good, because one password and one history serve the whole server, and a second database costs
  nothing until it is opened
* Good, because the list costs no statement: it comes with the cache's pass
* Bad, because another database's cache reads its own schemas on first open, so a server of many
  databases fills the plugin's store faster (16 chunks each, ADR 0285)
* Bad, because the per-console sessions (PG-02) must end a console's session when it switches, or its
  next run would still reach the old database
* Neutral, because one statement still reads one database: queries across databases stay out of
  scope

## More Information

Issue #450 (PG-13), plan #438; ADR 0281 (the core's sessions), ADR 0285 and ADR 0295 (the schema
cache and its server reader), ADR 0311 (the keychain), ADR 0286 (many consoles). Code:
`plugins/database/ui/databases.js`, `ui/explorer-databases.js`, `ui/features/databases/`,
`ui/manage-databases.js`, `ui/schema-cache/index.js`.
