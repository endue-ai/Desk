# desk-sys

Primitives: fs (notify), proc (portable-pty), net, shell, calendar (EventKit) and audio (cpal, wake
word), each behind a cargo feature. No permission checks: desk-core authorizes every call first. proc,
net, shell and calendar return `Error { code, message }` with the bridge `ErrorCode`; fs returns
`io::Error`s whose kind maps to it through `Error::from` (OS permission errors are `io_error`). Layer:
Tauri shell (see `docs/architecture.md`). Status: fs, proc, net, shell and calendar; audio later.

## Features and public API

- `fs`: `read`, `list` (sorted; `EntryKind` file, dir or symlink; `size` of files, `modified` of
  files and folders), `write(path, bytes, create_dirs)` (temp file + rename, keeps permissions,
  refuses folders and symlinks), `watch_debounced(path, WatchOptions { recursive, debounce },
  on_changes)` (one batch of `Changed { path, change }` per quiet period, created/modified/removed),
  and the raw `watch_changes(path, recursive, on_change)` and `watch`. Dropping a `Watch` stops it.
- `proc`: `spawn(&SpawnOptions { program, args, cwd, env, pty }, on_event) -> Process`, no shell,
  program looked up on PATH. `on_event` gets `Event::Output { stream, data }` (stdout, stderr or
  pty) and then `Event::Exit(Exit { code, signal })`, always last. `Process::write`, `resize` (PTY
  only), `kill(Signal::{Term, Kill, Int, Hup})`; children are always reaped, and drop kills. On
  Windows the PTY answers ConPTY's startup cursor query (`ESC[6n`) and closes the console on exit.
- `net`: `fetch(&Request { url, method, headers, body, timeout, allowed_hosts }) -> Response
  { status, headers, body }` over rustls with the OS trust store. Every URL, redirects included,
  must match `allowed_hosts` (`host_allowed`) before it is connected to, or the call is
  `permission_denied`. Non-2xx statuses are responses. At most 10 redirects and a 64 MiB body.
- `calendar`: `CalendarSource` (`authorization`, `request_access`, `calendars`, `events(from, to)`,
  `reminders(Status)`) answers `Calendar`, `Event` and `Reminder` with RFC 3339 times; `os()` is
  EventKit on macOS, `unsupported` elsewhere; `fake::FakeCalendar` for tests. Read only, and
  `permission_denied` without reaching the OS until it grants `FullAccess`. `NAME`: the crate name.
- `shell` (ADR 0047): `link` takes http, https and mailto URLs only; `SystemOpener` (`Opener`) runs
  `open_plan` or `reveal_plan` per `Os`, one argument and no shell: `open`, `xdg-open`, `ShellExecuteW`.

## Testing

```bash
cargo test -p desk-sys --all-features
```

Each `tests/<feature>.rs` needs its feature. proc tests run the test binary itself as the child
(`DESK_SYS_TEST_CHILD`); net tests serve from in-process listeners, never the network; shell tests
check the plans and launch nothing; calendar tests use the fake (EventKit's: `-- --ignored` on a Mac).
