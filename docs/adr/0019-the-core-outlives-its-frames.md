---
status: accepted
date: 2026-10-28
decision-makers: Team endue
---

# The core outlives its frames: closing the last frame keeps Desk running

## Context and Problem Statement

Tauri quits when the last window closes. With frames (ADR 0018) that would end every process, watch
and brain turn the moment the person closes a window, and the wake word could never wait for "Hey
Eris" without a window on screen. What happens when the last frame closes, and how does the person get
Desk back or quit it?

## Decision Drivers

* Work started in Desk (terminals, watches, turns, the wake word) should not depend on a window
* Desk must always stay reachable: no invisible process the person cannot find or quit
* Follow each OS's habits where they exist

## Considered Options

* The core stays: macOS keeps Desk in the Dock, Windows and Linux keep a tray icon
* Stay only while work is running, otherwise quit
* Follow OS convention (macOS stays, Windows and Linux quit)
* Always quit with the last frame

## Decision Outcome

Chosen option: "The core stays", chosen by the maintainers.

* Closing the last frame keeps the app and its core running (`ExitRequested` without a code is
  prevented). Work goes on; its events have no frame to go to until one opens.
* macOS: Desk stays in the Dock; clicking it opens `main` again. Quit is the app menu's Quit (Cmd+Q).
* Windows and Linux: a tray icon with Open endue Desk (also a left click), New Frame, Restart in Safe
  Mode and Quit endue Desk.
* Where no tray can be shown (Linux without the appindicator library), closing the last frame quits,
  so Desk is never running out of reach.
* Quitting stops everything the core started (`Core::shutdown`: watches end, processes are killed).

### Consequences

* Good, because terminals, turns and the wake word survive closing windows, and reopening Desk is
  instant.
* Good, because the tray gives Windows and Linux a visible way back and a way out, plus safe mode.
* Bad, because people who expect the last window to quit the app (Windows, Linux) must use Quit; the
  tray makes that visible.
* Bad, because a frame opened later does not see work started by a closed frame (ADR 0018).

## More Information

`apps/desk/src-tauri/src/lifecycle.rs`; the decision was taken by the maintainers when the stage-2
shell work was planned (options above were put to them).
