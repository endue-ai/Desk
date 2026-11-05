# desk-memory

Eris's memory on this computer (specs/memory/v0, ADR 0095): facts in `facts.yaml`, episodes in
`episodes/<YYYY-MM>.jsonl`, and a SQLite FTS5 index (`index.sqlite`) derived from both. The files are
the truth: a hand edit or a synced file is read on the next call, and the index is built again when the
files' fingerprint (name, size, time) differs from the one it was built from. Layer: Rust core.

## Public API

- `Memory::open(dir)`: the memory in `dir`, made when missing; a `facts.yaml` from a newer desk is
  `MemoryError::Invalid`. `with_clock` replaces the system clock, for tests.
- Facts: `remember(text, tags, by)`, `edit(id, text, tags)`. Episodes: `record(asked, answered,
  steps, by)`, filed under the month it ends in.
- `get(id)`, `list(kind, limit, cursor)` (newest first; `Page { entries, next }`), `search(query,
  kind, limit)` (any word of the query as a prefix, best first, with a snippet).
- `forget(id)` and `forget_all(kind)`: gone from the file and the index in the same call; they
  answer how many went.
- `MemoryError`: `NotFound`, `Invalid`, `Io`.

desk-core serves it on the bridge (`Core::with_memory_dir`, `memory.*`, `record_episode`).

## Testing

```bash
cargo test -p desk-memory
```

`tests/store.rs` covers remember, list, edit, forget (disk and search), forget everything, a reopened
store, a hand edit of `facts.yaml`, episodes by month and a lost index rebuilt from the files.
