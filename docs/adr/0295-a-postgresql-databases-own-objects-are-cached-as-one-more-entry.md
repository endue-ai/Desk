---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# A PostgreSQL database's own objects are cached as one more entry, without its secrets

## Context and Problem Statement

The explorer showed a PostgreSQL schema's tables, views, sequences and routines, and nothing else
(PG-50, #474). A database also holds types, aggregates, operators, collations and text search
configurations per schema; partitions, inheritance, row security policies and rules per table; and
objects of no schema: extensions, foreign data wrappers, foreign servers and user mappings,
publications, subscriptions, event triggers, casts and languages. Roles and tablespaces belong to the
whole server. The schema cache (ADR 0285) reads per schema, fingerprints per schema and stores per
schema. Where do the objects of no schema live in it, how is a change to them found, which PostgreSQL
versions are read, and what of them is never read because it may be a secret?

## Decision Drivers

* A pass stays a fixed number of statements, however many objects; a change reads only its level
* The cache's fingerprint, store, cap and reload work unchanged for the new kinds
* PostgreSQL 13 and later, each version asked only for what it has
* Never a password: a user mapping's options, a subscription's connection string, a role's hash
* Every kind's DDL as `d` shows a table's, from the cache, and it round-trips on a real server

## Considered Options

* The database level as a cache entry named "" (no schema can be), with its own fingerprint row
* A second cache beside the schema cache, with its own index and chunks
* Reading the database level on demand, when its folder opens, as before PG-06
* Roles and tablespaces in the same entry, or read on demand

## Decision Outcome

Chosen option: "the database level as a cache entry named """, because the pass, the merge, the
store and its cap already handle an entry; the entry is always chosen, is never listed as a schema,
and is kept first under the cap (then public, then by name).

**Readers.** Three more per schema, each one statement for every schema of a pass: types (enum,
composite, domain, range, base); aggregates, operators, collations and text search configurations;
partitions (under the root table, each with its bound), parents a table inherits from, policies and
rules. Two of the database level, read only when its fingerprint moved: the database's objects, then
roles and tablespaces. A first pass is twelve statements; a schema's change ten; a change at the
database level three; nothing changed one. Objects an extension owns or PostgreSQL made itself
(`pg_depend` deptype `e` or `i`, a range's constructors, an array type) and built-ins (oid < 16384,
roles named `pg_*`) are left out; an extension lists what it owns in its DDL.

**Fingerprint.** The fingerprint statement ends with one more row, "", whose mark joins a text per
catalog of the level: the count and summed `xmin` of its rows where they can be read, else an `md5` of
the columns that can (pg_roles, pg_user_mappings and pg_subscription, which most roles may read only
in part). Every row also carries `server_version_num`, so each reader asks for the columns its version
has (publications' schemas, column lists and row filters from 15; a subscription's options from 14,
15, 16 and 17); columns that came later inside a row are read through `to_jsonb(row)`.

**Secrets.** Never read: `pg_user_mapping.umoptions`, `pg_subscription.subconninfo`, `pg_authid` and
`rolpassword`, foreign tables' options. A wrapper's or server's option whose name holds pass, secret,
token or key is dropped in the statement; the DDL says how many were. A subscription's DDL is made with
`connect = false` and `CONNECTION ''`; a user mapping's without options.

**DDL.** From the cached rows, with no statement but a base type's I/O functions
(`pg_get_functiondef`). The owner is named on the first line (`-- Owner: x`), then the statements,
then `COMMENT ON`. Names are quoted; what a `pg_get_*def` returns is kept as the server wrote it. A
table's DDL (read afresh, as before) gains its row security lines; its row shows "RLS on" or "forced"
and an estimate of its size from `relpages`, without a lock.

### Consequences

* Good, because the explorer, `d` and completion (a schema's types) answer from the cache, and a role
  made by anyone is found at the next refresh in three statements.
* Good, because the kinds are one table (`ui/schema/pg/index.js`): a kind is a module and its lines.
* Good, because the round trip is tested on PostgreSQL 13 to 17.
* Bad, because the new kinds change the cache's signature: every kept cache is read once again.
* Bad, because on a shared server any role change moves the database level of every connection to it.
* Bad, because a server's hidden options, a mapping's options and a subscription's connection string
  are not in its DDL: they must be set by hand where it is applied.

## More Information

Issue #474 (PG-50), epic #438; ADR 0285 (the schema cache). Code: `plugins/database/ui/schema/pg/`,
`plugins/database/ui/schema-cache/`; tests: `plugins/database/tests/pg-kinds-*.test.ts`.
