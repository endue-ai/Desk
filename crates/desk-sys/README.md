# desk-sys

Primitives: fs (notify), proc (portable-pty), net and audio (cpal, wake word), each behind a cargo
feature. No permission checks: desk-core authorizes every call first.

Layer: Tauri shell (see `docs/architecture.md`). Status: `fs`, `proc` and `net`.

## Features and public API

- `fs`: `fs::read(path) -> Vec<u8>`, `fs::write(path, bytes) -> u64`, `fs::list(path) -> Vec<Entry>`
  (sorted by name; `EntryKind` file, dir or symlink; size for files), `fs::watch_changes(path,
  recursive, on_change)` (`Change { path, kind }`: created, modified or removed; a rename is a removal
  and a creation) and `fs::watch(path, on_path)`; dropping the `Watch` stops it.
- `proc`: `proc::spawn(Spec, on_output, on_exit) -> Process` without a shell, with pipes or a
  pseudo-terminal (`Spec.pty`); `Process::write`, `resize` (terminals only), `signal` (term, kill,
  int, hup; Windows ends the process), `pid`. Output is handed over before `on_exit`; dropping a
  running `Process` kills it.
- `net`: `net::fetch(&Request) -> Response` (ureq with rustls): one request, redirects returned not
  followed, bodies up to `MAX_BODY`; `NetError::Timeout` for a missed `timeout`.
- `NAME`: the crate name.

## Testing

```bash
cargo test -p desk-sys --all-features
```

`tests/fs.rs`, `tests/proc.rs` (Unix) and `tests/net.rs` (a local server) need their features
(declared with `required-features`).
