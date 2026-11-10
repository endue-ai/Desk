# desk-sys

Primitives behind cargo features (on Linux, `audio` needs `libasound2-dev`). Layer: the shell. No
permission checks: desk-core authorizes every call first. Calls return `Error { code, message }` (bridge
`ErrorCode`); `Error::from` maps fs `io::Error`s, OS permission ones to `io_error`. `NAME`: crate name.

## Features and public API
- `fs`: `read`, `list` (sorted `Entry`s) and `stat` (`Stat { kind, size, modified, readonly }`), links
  never followed; `write(path, bytes, create_dirs)` and `copy(from, to) -> bytes` (temp + rename, keep
  permissions, links copied as links); `mkdir(path, parents)` (the folders made); `rename(from, to)`;
  `copy` and `rename` never overwrite; `trash(path)` (trash crate, NSFileManager on macOS, no delete);
  `watch_debounced(path, WatchOptions, on_changes)`, `watch_changes` and `watch` (dropping stops it).
- `proc`: `spawn(&SpawnOptions { program, args, cwd, env, pty }, on_event) -> Process`: no shell, PATH
  lookup, `Event::Output { stream, data }`, `Event::Exit(Exit { code, signal })` last; `write`, `resize`
  (PTY), `kill(Signal)`; always reaped, drop kills; a Windows PTY answers `ESC[6n` and closes at exit.
- `net`: `fetch(&Request) -> Response` (any status), `ws::connect(..) -> Socket`, `sse::open(..) ->
  Stream` (`on_event`, `Closed` last, drop closes); rustls, OS roots; each URL and redirect must match
  `allowed_hosts` or it is `permission_denied`. `proxy::Resolver`: env, else system PAC (boa) or proxy.
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
- `audio`: `AudioInput` (`authorization`, `request_access`, `devices`, `capture(&CaptureOptions,
  on_event) -> Capture`): mono `i16` `Frame { samples, level, at_ms }`s of 20 ms at 8 to 48 kHz, `End`
  last, `stop` or drop; `permission_denied` until `Authorized`. `os()`: cpal; `fake::FakeInput`.

## Testing
`cargo test -p desk-sys --all-features`; `docs/qa/TESTING.md` says what each file proves. proc, Linux
trash and net_proxy run the test binary as the child (`DESK_SYS_TEST_CHILD`); the rest use fakes, local
servers, temp folders, a test key; ignored: EventKit, OS mic, clipboard and proxies, Mac/Windows trash.
