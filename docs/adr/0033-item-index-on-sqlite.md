---
status: accepted
date: 2026-10-31
decision-makers: Team endue
---

# The item index is its own crate on one SQLite file, with times in UTC and the scope in the SQL

## Context and Problem Statement

ADR 0032 made connected data items of one model. Something on the device has to keep them:
connectors put items in, views, search and agents read them, every read under the caller's
`data:read` scope (DM-02, DM-03); a person can delete a source's items or rebuild the index
(DM-05, PRV-05); items never leave the device (PRV-01). Where does the index live, what stores it,
how do times written with different offsets compare, where is the scope applied, and how much does
it keep by default?

## Decision Drivers

* A page of 50 out of tens of thousands of items in a few milliseconds, with full-text search
* A caller never sees an item its scope does not cover, and a page is never short because of it
* `2026-10-30T09:00:00+09:00` sorts before `2026-10-30T01:00:00Z`: instants, not strings
* No server, no daemon, no `unsafe` code; one file that a person can delete
* The core stays a kernel and knows separate crates by a trait (PKG-01)

## Considered Options

* SQLite (rusqlite with `bundled`: FTS5 and the JSON functions compiled in) in a crate `desk-index`
* An embedded key-value store (redb, sled) plus a search index (tantivy)
* JSON files per source, loaded and filtered in memory
* Any of these inside `desk-core`

## Decision Outcome

Chosen option: "SQLite in a crate `desk-index`", because one file gives transactions, indexes,
full-text search and JSON paths together. A key-value store plus tantivy is two stores to keep in
step and every filter, sort and page written by hand; JSON files miss the budget past a few
thousand items; inside `desk-core` the kernel would carry a database. The core holds the index as
`Arc<dyn ItemIndex>`.

* **Schema 1.** `items` is keyed by `(connector, instance, id)` and holds the envelope, the whole
  item as `json`, `status` and `unread`, and epoch-second `*_utc` columns for `updatedAt`,
  `createdAt`, `start`, `end`, `due`, `receivedAt` and `publishedAt`, filled on upsert; `where` and
  `sort` on those fields use them. Other paths go through `json_extract`. Indexes:
  `(kind, updated_at_utc)` and `(connector, instance, updated_at_utc)`. An explicit
  `seq INTEGER PRIMARY KEY` is the row id the FTS5 table (title and body, `unicode61`, kept by
  triggers) points at, because SQLite may renumber implicit row ids on `VACUUM`.
* **Versions.** `PRAGMA user_version` holds the schema version; migrations run forward, one
  transaction per step, and a file a newer desk wrote is refused as `unsupported`, never rewritten.
  `rebuild()` recreates the full-text table and reindexes; the items stay.
* **The scope is SQL.** `DataReadScope` (kinds, connector id patterns with `*` as in `cmd:invoke`)
  is a `WHERE` clause beside the query's own, so `limit`, the cursor and the count see covered rows
  only. Paging is keyset: the cursor is the last row's sort values and key, ties go by id,
  connector and instance, and missing values sort last either way.
* **Subscriptions** re-ask each write's keys with every subscription's filter before and after it:
  one batch per write, and an item that stops matching arrives as removed.
* **Limits** per source (connector and instance) default to 50 000 items and no retention period;
  they apply after each upsert, oldest `updatedAt` first. The core sets them from the connector's
  settings; they are not stored in the file.
* **No encryption.** The file sits in the data folder like the grants file (ADR 0029), protected
  by the OS account and the disk's own encryption. Encrypting it (SQLCipher) needs a key to keep
  somewhere the same account can read, plus OpenSSL; the threat model gains nothing from it today.

### Consequences

* Good, because storage, search and JSON paths are one dependency, and a page of one kind out of
  10 000 items takes about 0.3 ms on a debug build (budget: 50 ms, `tests/perf.rs`).
* Good, because no code path can hand a caller an item outside its scope or a short page.
* Good, because deleting a source is one call (`clear`) and deleting everything is one file.
* Bad, because SQLite is C compiled into the app: build time and a C memory-safety surface. The
  build already needs a C compiler (wasmtime), and the licences are MIT and public domain.
* Bad, because one connection behind a mutex serves every call, so reads wait for writes. A reader
  pool comes when a profile shows the wait.
* Bad, because `unicode61` splits on spaces and punctuation: Korean, Japanese and Chinese match by
  word prefix only, not inside a word. A trigram table would be schema 2.
* Bad, because times are kept to the second (fractions tie, then id), and `completedAt`,
  `modifiedAt` and times inside `raw` still compare as strings until a later schema adds columns.
* Bad, because the file is readable by any process of the same OS account, like the rest of the
  data folder.

## More Information

Issue #94; `crates/desk-index/README.md`. Requirements DM-02, DM-03, DM-05, PRV-01 and PRV-05 of
the integration requirements draft (not in the repository yet, see ADR 0032), and PKG-01 of
`docs/ko/desk-requirements.md`. ADR 0032 (items, views, connectors), ADR 0029 (the grants file in
the data folder). Serving `data.*` from the core is a later task; the crate gets its line in
`docs/ko/desk-structure.md` and `docs/architecture.md` with it.
