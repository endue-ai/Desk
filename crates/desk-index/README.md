# desk-index

The local item index (ADR 0033): `specs/item/v0` items in one SQLite file in the data folder, with
FTS5 over title and body. Connectors put items in; views, search and agents read them through the
caller's `data:read` scope, applied inside the SQL, so a page is full and holds only covered rows.
No other permission checks: desk-core decides who holds which scope.

Layer: Rust core (see `docs/architecture.md`). Status: the index; desk-core serves `data.*` later.

## Public API

- `Index::open(path)`: open or create the file (WAL), migrated to `SCHEMA_VERSION` in `PRAGMA
  user_version`; a newer file is `unsupported`. The core holds it as `Arc<dyn ItemIndex>`.
- `upsert(&[Item])` by source and id, one transaction (a known time field without an offset is
  `invalid_params`); `remove(source, ids)`, `clear(source)`, `get(source, id, &scope)`.
- `query(&ItemQuery, &DataReadScope) -> ItemPage`: `kinds`; `sources` (`connector` or
  `connector/instance`); `text` (each word a prefix in FTS5, all required); `where` (all hold; `ne`
  holds for a missing field); `sort` (missing values last, ties by id, connector, instance); an
  opaque cursor; `limit` 50 by default, 500 at most. `count` is the total over its pages.
- `kind`, `source.*`, `status`, `unread`, `title`, `body`, `id` are columns; `updatedAt`,
  `createdAt`, `start`, `end`, `due`, `receivedAt`, `publishedAt` compare as instants (epoch-second
  `*_utc` columns); other paths (`raw.labels`, `points.0.v`) go through `json_extract`.
- `DataReadScope { kinds, sources }` (`From<DataReadPermission>`): `None` is all, `[]` none; `*`
  in a source pattern matches any run of characters, dots included.
- `subscribe(&query, &scope) -> Receiver<Vec<ItemChange>>`: one batch per write, sent before the
  write returns; an item that stops matching arrives as `removed`; a dropped receiver ends at its
  next delivery (`subscription_count`).
- `set_limits(source, Limits { max_items, keep_days })` (default 50 000 and kept forever), applied
  after each upsert, oldest `updatedAt` first; `counts()` per source; `rebuild()` recreates FTS.
- `Error { code, message }` with the bridge `ErrorCode`; every SQLite failure is `io_error`.

## Testing

```bash
cargo test -p desk-index
```

`tests/{query,subscribe,retention,migrate}.rs` use fresh files in the temp folder; `migrate.rs`
opens the frozen `tests/fixtures/schema-v1.sql`; `perf.rs` wants one kind out of 10 000 items in
under 50 ms (the median of five queries after a warm-up).
