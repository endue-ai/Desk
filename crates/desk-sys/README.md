# desk-sys

Primitives: fs (notify), proc (portable-pty), net and audio (cpal, wake word), each behind a cargo
feature. No permission checks: desk-core authorizes every call first. Errors are `Error { code,
message }` with the bridge `ErrorCode` (OS permission errors are `io_error`).

Layer: Tauri shell (see `docs/architecture.md`). Status: fs, proc and net; audio comes later.

## Features and public API

- `fs`: `read`, `list` (sorted; `EntryKind` file, dir or symlink), `write(path, bytes, WriteOptions
  { create_dirs })` (temp file + rename, keeps permissions, refuses folders and symlinks),
  `watch_debounced(path, WatchOptions { recursive, debounce }, on_changes)` (one batch of
  `Changed { path, change }` per quiet period, created/modified/removed). `watch` is the raw,
  undebounced watch of desk-core's hot reload. Dropping a `Watch` stops it.
- `proc`: `spawn(&SpawnOptions { program, args, cwd, env, pty }, on_event) -> Process`, no shell,
  program looked up on PATH. `on_event` gets `Event::Output { stream, data }` (stdout, stderr or
  pty) and then `Event::Exit(Exit { code, signal })`, always last. `Process::write`, `resize` (PTY
  only), `kill(Signal::{Term, Kill, Int, Hup})`; children are always reaped, and drop kills.
- `net`: `fetch(&Request { url, method, headers, body, timeout, allowed_hosts }) -> Response
  { status, headers, body }` over rustls with the OS trust store. Every URL, redirects included,
  must match `allowed_hosts` (`host_allowed`) before it is connected to, or the call is
  `permission_denied`. Non-2xx statuses are responses. At most 10 redirects and a 64 MiB body.
- `NAME`: the crate name.

## Testing

```bash
cargo test -p desk-sys --all-features
```

`tests/{fs,proc,net}.rs` each need their feature (`required-features`). proc tests run the test
binary itself as the child (the `child` test, active only with `DESK_SYS_TEST_CHILD`); net tests
serve from in-process listeners and never touch the network.
