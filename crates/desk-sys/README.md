# desk-sys

Primitives behind cargo features (audio, with cpal and a wake word, later). Layer: Tauri shell. No
permission checks: desk-core authorizes every call first. Calls return `Error { code, message }` (bridge
`ErrorCode`); `Error::from` maps fs `io::Error`s, OS permission ones to `io_error`. `NAME`: crate name.

## Features and public API

- `fs`: `read`, `list` (sorted `Entry`s) and `stat` (`Stat { kind, size, modified, readonly }`), links
  never followed; `write(path, bytes, create_dirs)` and `copy(from, to) -> bytes` (temp + rename, keep
  permissions, links copied as links); `mkdir(path, parents)` (the folders made); `rename(from, to)`;
  `copy` and `rename` never overwrite; `trash(path)` (trash crate, NSFileManager on macOS, no delete);
  `watch_debounced(path, WatchOptions, on_changes)`, `watch_changes` and `watch` (dropping stops it).
- `proc`: `spawn(&SpawnOptions { program, args, cwd, env, pty }, on_event) -> Process`, no shell,
  program looked up on PATH; `Event::Output { stream, data }`, then `Event::Exit(Exit { code, signal
  })` last. `Process::write`, `resize` (PTY), `kill(Signal)`; children always reaped, drop kills. On
  Windows the PTY answers ConPTY's startup cursor query (`ESC[6n`) and closes the console on exit.
- `net`: `fetch(&Request { url, method, headers, body, timeout, allowed_hosts }) -> Response` over
  rustls with the OS trust store; every URL, redirects included, must match `allowed_hosts` or it is
  `permission_denied`. Non-2xx statuses are responses. At most 10 redirects and a 64 MiB body.
- `calendar`: `CalendarSource` (`authorization`, `request_access`, `calendars`, `events(from, to)`,
  `reminders(Status)`), RFC 3339 times; `os()` is EventKit on macOS, `unsupported` elsewhere;
  `fake::FakeCalendar`. Read only; `permission_denied` without reaching the OS until `FullAccess`.
- `notification`: `Notifier` (`authorization`, `request_authorization`, `post`, `on_click` with `Click
  { id }`): `permission_denied` without the OS until `Authorized`; posting never prompts. `os(app_id,
  app_name)`: UserNotifications on macOS (`unsupported` outside an app bundle), toasts on Windows, zbus
  on Linux (`freedesktop::Freedesktop::new(connection, app_name)` too); `fake::FakeNotifier`.
- `shell` (ADR 0047): `link` takes http, https and mailto URLs only; `SystemOpener` (`Opener`) runs
  `open_plan` or `reveal_plan` per `Os`, one argument and no shell: `open`, `xdg-open`, `ShellExecuteW`.
- `login`: `apply(items, wanted, &desk(program)) -> Change` writes only on a difference; `check(..)` is
  `Status { registered, wanted, matches }`. `os(ID)`: a LaunchAgent (macOS), the Run key, XDG autostart;
  `fake::FakeLoginItems`. `launched_at_login` reads `BACKGROUND`; `program()`: the exe or `$APPIMAGE`.
- `clipboard`: `Clipboard` (`state` reads no text: `State { count, has_text, marks }`; `read_text`;
  `write_text(.., Marks { concealed, transient })`); `Changes`, `watch`; `os()`; `fake::FakeClipboard`.

## Testing

`cargo test -p desk-sys --all-features`; the desk-sys row of `docs/qa/TESTING.md` says what each file
proves. proc and Linux trash run the test binary as the child (`DESK_SYS_TEST_CHILD`); the rest use
fakes, in-process servers, temp folders, a test key; ignored: EventKit, OS clipboard, Mac/Windows trash.
