---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0070 (which windows start asleep) and ADR 0040 (what a close shows next).

# What the person closed, put away and placed stays so

## Context and Problem Statement

The QA pass of 2026-11-11 (#163) found four ways the desk did not keep what the person did with
its windows. A window closed by its × came back at the next start, some twice (finding 3); on main
the centre windows stay closed, since a restored session starts the plugins it does not show asleep
(#590), but Status and Plugins, whose surfaces are placed right and left, came back: the rule
counted only centre and floating surfaces as windows, though under the shell every surface but an
overlay and the bottom bar is one. Closing a window with ⌘W brought the window in the drawer back
out and gave it the focus (finding 6): desk.buffers shows the buffer used before the one closed,
and a window used and then put away was that buffer. ⌘W closed a pane used before instead of the
window a title-bar press had just put in use (finding 5): the buffer in use followed the runtime's
focus, which a press desk-wm took does not always move. And the app window opened at 1280×800 in
the same place at every start (finding 9): nothing kept its frame. What does each keep, and where?

## Decision Drivers

* A window the person closed, put away or placed is where they left it after a restart and after
  a close elsewhere
* ⌘W acts on what the desk shows in use
* No new bridge method, event or setting (`specs/` stays as it is)

## Considered Options

* Fix each where it goes wrong: the start-asleep rule knows the shell's windows, a close shows the
  last buffer used that is in sight, the buffer in use follows the window manager, the shell keeps
  the app window's frame in a file of its own
* Keep a list of closed plugins in the session and unmount them after the restore
* Keep the app window's frame in the session record (`desk.session`)

## Decision Outcome

Chosen option: "fix each where it goes wrong", because each cause is a rule that missed a case, and
each fix keeps one owner: the plugin host decides what starts asleep, desk.buffers what shows after
a close, desk-wm which window is in use, the shell the OS window.

* **Closed stays closed** (`frames/start-asleep.ts`): on a desk with a window host, every enabled UI
  plugin whose surface is not an overlay or the bottom bar is a window, so one the saved session does
  not show starts asleep (ADR 0070), a left or right one too. Without a window host (the fixture
  pages) the edge bars mount as before. Its window comes back on its first use, as any asleep one.
* **The drawer keeps its window** (`policies/buffers.ts`): after a close, the buffer that shows is the
  last one used whose surface is in sight (shown and on the page), not one in the drawer or on
  another desktop; none in sight shows none. Switching to a buffer (⌘B, next, previous) still
  brings it back from wherever it is: the person asked for it.
* **⌘W acts on the window in use** (`views.ts`, `shell/panes.ts`): the host's views name the plugin
  surface the window manager has in use (`focusedPlugin`), and its buffer becomes the buffer in use
  whenever that changes, however the focus came: a press desk-wm took, a command, a close.
* **The app window's frame** (`apps/desk/shell/src/main_frame.rs`): kept in `<data>/desk-window.json`
  (`{ x, y, width, height }`, logical pixels; on macOS the content's corner, where winit opens a
  window) half a second after a move or a resize rests, and when the desk quits. A start opens the
  window there when a display's work area shows at least 120 px of its top strip, else at the kept
  size where the OS puts it, between the least size (1024×500) and the display's. Full screen,
  minimized and hidden keep the frame from before.

### Consequences

* Good, because a restart shows the windows open at the quit, side windows included, and a close
  never pulls a put-away window back.
* Good, because ⌘W closes what shows as focused even when the runtime's own focus lags the desk.
* Good, because the frame is the shell's, read before any page exists, so the first frame drawn is
  at the right size; the session record stays the runtime's.
* Bad, because a side plugin started asleep has no live page until its first use: what its page
  would have shown at once (Status's counts) waits for its window.
* Bad, because a frame kept on a display that is gone opens where the OS puts a new window, not on
  the nearest display.
* Neutral: a window that comes back on a display arrangement macOS changed may be moved by the OS
  to fit, and the next rest keeps where it went.

## More Information

Issue #163 (QA pass 2026-11-11, work order B12), findings 3, 5, 6 and 9. Code:
`packages/runtime/src/frames/start-asleep.ts`, `packages/runtime/src/runtime.ts`,
`packages/runtime/src/policies/buffers.ts`, `packages/runtime/src/views.ts`,
`packages/runtime/src/shell/panes.ts`, `apps/desk/shell/src/{main_frame,window}.rs`,
`apps/desk/shell/src/compositor_window/commands.rs` (`compositor_window { frame }`, development
builds). Tests: `packages/runtime/src/frames/start-asleep.test.ts`,
`packages/runtime/src/policies/buffers.test.ts`, `packages/runtime/src/views.test.ts`,
`packages/runtime/src/shell/panes.test.ts`, `apps/desk/shell/src/main_frame.rs`,
`e2e/specs/session-keeps.spec.ts`. No section of `docs/ko/desk-structure.md` changes.
