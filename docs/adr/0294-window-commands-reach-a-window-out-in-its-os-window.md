---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# The window commands reach a window out in its OS window

## Context and Problem Statement

A window of one plugin can pop out of the canvas into an OS window of its own (issue 235, ADR
0205). The window manager keeps it (its id, its desktop, its canvas place) and the shell reports
the OS window's frame back (`OutFrame`), but nothing on the desk's side moves that OS window. The
window commands Eris uses (`desk.windows.move`, `resize`, `fill`, `pin`, `new-tab`, `close-tab`,
ADR 0269, ADR 0270) refused such a window ("move it back to the desk first"), so once the person
popped a window out, Eris could only focus it, close it or dock it. How do those commands reach an
OS window, in which units, and what does a tab mean for a window that has no tab strip?

## Decision Drivers

* Eris controls a window out of the canvas as she controls one on it, with the same commands
* The OS window moves as the person's drag, resize and zoom would move it: no second frame model
* Only the desk's own page may move an OS window; no plugin reaches it
* The compositor, the window manager and the web host stay as they are (the motion gate, ADR 0208)
* A desk without OS windows (the runtime's tests, fixture pages) says so instead of pretending

## Considered Options

* The desk asks the shell for the OS window directly (`app_window`), in points of the OS's screens
* The window manager's out frame becomes a command: the runtime sets `Placement::out` and the
  shell follows it
* Keep refusing; Eris docks the window, arranges it and pops it out again

## Decision Outcome

Chosen option: "The desk asks the shell for the OS window directly". The runtime's window manager
host gets an optional `outWindow(window, ask)` (`packages/runtime/src/wm/host.ts`); the app answers
it through a new shell call `app_window`, allowed to the desk's own page only
(`crates/desk-web/src/sender.rs`), which `apps/desk/shell/src/app_windows/control.rs` runs on the
event loop. `frames.rs` plans where the OS window goes, as pure functions:

* `move` to a point or by a step, its title bar kept within reach on a display;
* `resize` no smaller than the app's manifest allows (ADR 0226), no larger than the display's work
  area, its corner kept; a window whose app keeps its size keeps it;
* `fill` takes an edge's half, a corner's quarter or all of the work area of the display it is on
  (the screen less the menu bar and the Dock), and `none` brings it back where it was; a fill the
  person has since dragged away from is over;
* `pin` keeps it above other OS windows.

Each answers where the OS window is in points, with `out: true` and its display's work area
(`screen`), so the frame reads as `desk.windows.list`'s `out` frame. A window out has no tab strip,
so `new-tab` opens the plugin's next window (ADR 0212) and pops it out into an OS window of its own,
as a new window of an OS app opens, and `close-tab` of its one tab closes the window, asking about
unsaved changes first. `float` and `move-to-desktop` are canvas-only and still say to dock first.

Making the out frame a command was rejected: the shell reports the OS window's frame only once it
rests (debounced), so a desk frame arriving during the person's drag would snap the window back,
and it would change `desk-wm`, which the motion gate guards. Docking and popping out again reloads
the plugin's page each time and loses where the person put the OS window.

### Consequences

* Good, because every window command Eris has works on a window wherever it shows.
* Good, because the OS window moves exactly as a person's move does: its frame reaches the window
  manager the same way, and its place is kept per display (`places.rs`).
* Neutral, because an out window's frame is in points of the OS's screens, not CSS pixels of the
  desk; the answer says `out: true` so an agent knows which space it is in.
* Bad, because the fill and the pin live in the shell and are forgotten when the OS window opens
  again (a dock and a pop out, a restart).
* Bad, because outside macOS the work area is the whole display (`displays.rs`), so a fill covers
  the taskbar until that gap closes.

### Confirmation

`packages/runtime/src/arrange/out-control.test.ts` runs each command on a window popped out over
desk-wm as WebAssembly; `apps/desk/shell/src/app_windows/frames_tests.rs` checks the plans;
`apps/desk/src/compositor-wm.test.ts` checks the call the app makes; `crates/desk-web` checks that
only the desk's page may make it.
