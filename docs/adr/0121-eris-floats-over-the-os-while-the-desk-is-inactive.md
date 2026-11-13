---
status: proposed
date: 2026-11-07
decision-makers: Team endue
---

Status: amended by ADR 0203: the floating Eris becomes the island, one surface over every app that also
shows the agents' work and what waits for an answer (#238).
ADR 0204 says what the island is; the floating Eris retires once the island talks to Eris.

# Eris floats over the OS while the desk is inactive, and Option+Enter summons her anywhere

## Context and Problem Statement

Eris lives inside the desk's main window (`packages/runtime/src/eris/Eris.ts`, mounted by the shell,
`Alt+Space` and `desk.shell.talk` open her composer). The moment the person switches to another app,
or hides or minimizes the desk, she is gone. The person asked (#546): while the desk is active she
stays inside it; while it is not, she floats over the OS; and Option+Enter, from anywhere, calls her.
How does one Eris (ADR 0027) live in two windows, which key summons her and what does it cost, and
what does the floating window need from the platform?

## Decision Drivers

* One Eris and one conversation: what is said in the floating window is the desk's conversation, and
  the desk picks it up where the person left it (ADR 0027)
* The desk inside stays exactly as it is: same figure, same composer, same snapshots
* Never take the focus from the app the person is working in, never fight their windows
* The template that already works: the palette window (`apps/desk/src-tauri/src/palette.rs`, ADR 0053)
* Rules that can be tested without a window; macOS first, Windows and Linux with what Tauri has

## Considered Options

* A second webview window (`eris`, `index.html?view=eris`) with its own small view, calling the core
  as the desk; a pure state machine decides when it shows; the two windows share Eris's state
  through the app's storage
* The same window: shrink the main window to her figure while the desk is inactive
* A second full runtime in the floating window, mounting the shell's Eris with its own store
* Native panels (NSPanel through a third-party crate) instead of a Tauri window

## Decision Outcome

Chosen option: "a second window with its own view, calling the core as the desk", because it leaves
the desk untouched, follows the palette's proven shape and keeps the conversation in one place, the
core's `desk` caller.

* **When she floats** (`apps/desk/src-tauri/src/eris_window/machine.rs`). In go the focus of the main,
  palette and floating windows, whether the main window is on screen (shown, not minimized), the
  setting and the shortcut; out come show, hide, summon and "open her composer in the desk". The
  setting is `endue.eris.float` (declared by `plugins/eris`): `auto` (default) floats while the desk is
  not the active app, `always` also over the active desk, `never` not at all. Focus moves in bursts,
  so the window layer decides 150 ms after the last change; the palette passing through changes
  nothing (no flash of Eris over Search Desk); her own window in focus keeps her. Nothing floats
  until the desk has been in front once in a run (a desk started in the background, or on a display
  without a window manager such as the app e2e's Xvfb, never reports its focus); the shortcut
  summons her anyway. Esc, or the shortcut while she is in front, sends her away until the desk is
  next in front or she is summoned.
* **The window** (`eris_window.rs`, `eris_window/frame.rs`). Always on top, on every Space and over
  full-screen Spaces (`CanJoinAllSpaces | FullScreenAuxiliary | Stationary | IgnoresCycle` through
  `objc2-app-kit`), out of the Dock, the task switcher and window cycling, transparent around her,
  no shadow, first click accepted. A passive show uses `orderFrontRegardless` on macOS and an
  unfocusable window elsewhere, so the app in front keeps the focus; a summon focuses it. It grows
  for the composer keeping her figure where it is and folds back. Her spot is kept per display (the
  middle of the window's top edge from the display's work area) in `<data>/eris-window.json`. Its
  commands are the app's inline plugin `eris-window`, allowed to her window only.
* **Transparency needs `macos-private-api`.** Tauri's `macos-private-api` feature and
  `app.macOSPrivateApi: true` make the window clear around her. Apple does not accept private API in
  the Mac App Store; the desk ships outside it (ADR 0054), so nothing is lost now. A store build would
  turn the feature off and she would sit in a small plain window, as on platforms without
  transparency.
* **One conversation** (`commands/bridge.rs`). The floating window's bridge calls go to the core as
  `desk`, whatever caller they name, and only `brain.say` and `brain.status` are let through: the
  window talks to Eris and can do nothing else the desk may. Her turns follow `brain.turn` as the
  shell does; the brain keeps the conversation per caller, so it is one.
* **One Eris** (`packages/runtime/src/eris/float.ts`, `float-desk.ts`). The desk's runtime writes a
  snapshot of her (state, talk phase, latest line, the last twelve lines) to the app's storage, which
  both windows share as the palette shares the theme (ADR 0056); the floating window writes back the
  person's line, her state while a turn runs and her answer. The desk takes her state at once and
  says the answer once its window is in front, so the conversation goes on in the desk. A new start
  is a new transcript; the brain keeps the history.
* **Option+Enter.** `Alt+Enter` (⌥↩) is registered globally with `tauri-plugin-global-shortcut`; the
  setting `endue.eris.shortcut` or `DESK_ERIS_SHORTCUT` (as `DESK_PALETTE_SHORTCUT`) names another.
  While the desk is active it runs the runtime's new `desk.eris.summon` through the core (her composer
  opens, or closes when it is open); otherwise it summons the floating window with its composer open,
  or, with floating `never`, brings the desk forward and opens it there. When the key cannot be had,
  the desk says so with a notice (`ui.notify`, once the runtime listens) and the tray's new "Talk to
  Eris" does the same as the key.

Rejected: shrinking the main window loses the person's layout and every plugin's state on each
switch; a second runtime would load every plugin twice and split the store; NSPanel would make
clicking her not activate the desk, which is better, but adds an unaudited crate and a second window
system for one window, and is a follow-up if activation proves to be a problem.

### Consequences

* Good, because Eris is reachable from any app with one key, in the same conversation, and the desk
  inside renders exactly as before.
* Good, because every rule (modes, focus bursts, the shortcut by active window, spots per display) is
  plain Rust with tests, and the view runs on the browser stub in WebKit.
* Bad, because a global `⌥↩` takes the key from every app while the desk runs: Slack, Teams and
  Excel use it for a new line or a line break in a cell. The person asked for it; the setting and the
  environment variable change it, and the notice says how.
* Bad, because `macos-private-api` rules out the Mac App Store unless the feature is turned off for
  that build.
* Bad, because clicking the floating window activates the desk on macOS (a regular window, not a
  non-activating panel); only that window comes forward, and the main window stays where it was.
* Bad, because the two windows talk through storage events: a write the other window misses while it
  reloads is caught up by the next snapshot, not replayed.

## More Information

Issue #546. Template: `apps/desk/src-tauri/src/palette.rs` and `capabilities/palette.json` (ADR 0053).
Related: ADR 0027 (one Eris), ADR 0054 (releases outside the store), ADR 0056 (the palette window
follows the theme through storage), ADR 0078 (approvals her status waits on), ADR 0089 (her agentic
loop). Not here: Settings showing the shortcut's state (follow-up; today the notice and the tray say
it), the OS notification centre for desk notices while it is inactive (#521), voice in the floating
window (she listens only in the desk).
