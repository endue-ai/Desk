# desk-computer

Computer use (ADR 0120): see and operate every app on this computer, and report and request the OS
permissions it takes. Layer: Tauri shell, beside desk-sys. No Desk grants are checked here: the core
authorizes callers and supplies the guard. Errors are desk-sys's `Error { code, message }`.

## Public API

- `Computer` (trait): `permissions` (Accessibility, Screen Recording, the bundle TCC asks about),
  `request`, `open_settings` (the System Settings pane; `Permission::settings_url`), `displays`,
  `windows(WindowScope)`, `screenshot(&Capture)` (PNG, size, scale, bounds; `Capture::fit`),
  `focused`, `tree(&ElementRef, Budget)`, `find(.., &Query, ..)`, `apps`; acts take a `Permit`:
  `post(Event)`, `perform(AxAction)`, `set(Setting)`, `launch(Launch)`, `app(pid, AppOp)`.
- `os()`: macOS (AXUIElement, CGEvent, ScreenCaptureKit on 14+ else CGWindowListCreateImage,
  NSWorkspace); `unsupported` for every call elsewhere. `fake::FakeComputer` records `Call`s and
  answers scripted screens, trees and apps; `fake::FakeClock` for rate-limit tests.
- `Control::new(computer, guard)`: the only way to act. `act(Action)` (and `mouse`, `key`, `text`)
  plans the events, asks the `Guard` (`Verdict::Refuse` is `permission_denied`), queues one action
  at a time, waits for the `RateLimit` and checks the `StopFlag` before every event (`cancelled`),
  releases keys and buttons an aborted action held, and answers `Done { summary, events, .. }`.
  `Action::describe` says an action in words before it runs, for the core's approval card.
- `ax`: `Element`, `Node`, `Tree`, `ElementRef` (pid + child-index path + expected role), `Budget`
  (depth, nodes; capped at 64 and 5000), `Query` (role, title, exact, limit), `walk`/`tree`/`find`
  over any `Source`, breadth first.
- `input`: `Mouse`, `Event`, `plan_mouse`, `plan_chord`, `plan_text`, `chunks` (≤ 20 UTF-16 units on
  grapheme boundaries); `keys`: `Chord::parse("cmd+shift+t")`, `Key`, `Modifiers`, `mac_code`.

## Testing

`cargo test -p desk-computer`: `tests/fake.rs` and `tests/control.rs` (`Control` over the fake:
order, scripted screens and trees, permissions, guard, stop flag, rate limit), `tests/api.rs`
(budgets, finder, chunking, chords, capture sizes), `tests/unsupported.rs` (off macOS).
`tests/macos.rs` is ignored: read-only checks of the real OS, run on a Mac with
`cargo test -p desk-computer --test macos -- --ignored`; it never posts input.
