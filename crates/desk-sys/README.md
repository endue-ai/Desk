# desk-sys

Primitives: fs (notify), proc (portable-pty), net and audio (cpal, wake word), each behind a cargo
feature. No permission checks: desk-core authorizes every call first.

Layer: Tauri shell (see `docs/architecture.md`). Status: `fs` only.

## Features and public API

- `fs`: `fs::read(path) -> Vec<u8>`, `fs::list(path) -> Vec<Entry>` (sorted by name; `EntryKind`
  file, dir or symlink; size for files).
- `NAME`: the crate name.

## Testing

```bash
cargo test -p desk-sys --all-features
```

`tests/fs.rs` needs the `fs` feature (declared with `required-features`).
