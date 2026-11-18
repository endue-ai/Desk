---
status: accepted
date: 2026-11-18
decision-makers: Team endue
---

# Agents control every window in pixels through the desk's window commands

## Context and Problem Statement

Eris reads every window's rect in whole CSS pixels (`BrainDeskWindow`, ADR 0109, ADR 0124), and her
tools could focus, close, tile, cascade, spread, put away, pop out, dock and reopen windows. Nothing let
her move or resize one: "put the terminal at 100, 80, 900 wide", "snap notes to the right half" or "pin
the calendar" had no tool. The keys' window commands (`desk.display.*`, ADR 0153) act only on the
window in use and by a 32-pixel step, and are not offered to agents. How does an agent do everything
the person can do with a window, in the pixels it reads?

## Decision Drivers

* One coordinate space: what desk.windows.list says, what a command takes and what it answers
* The window manager keeps its rules (smallest size, a plugin's fixed size, the title bar in reach, a
  floating window on screen); an agent cannot place a window where the person could not
* The same paths as the person's buttons, keys and drags, in the compositor and in the wasm window
  manager alike (#83), with no second way to change a window
* Asking for the state a window is already in changes nothing: an agent's retry is safe
* Few tools: a turn offers at most 32 (ADR 0089)

## Considered Options

* Agent commands in the runtime over the window manager's existing window commands and edits
* New desk-wm ops (an absolute frame, an unfill) that the compositor and the wasm window manager run
* Offer the keys' `desk.display.*` commands to agents as they are
* Eris drags windows with the pointer under computer grants (ADR 0123)

## Decision Outcome

Chosen option: "agent commands in the runtime over the existing window commands and edits",
because the window manager already moves and resizes by pixels with all its rules, so an absolute place
is the step from where the window is drawn now, and no compositor or desk-wm code changes.

* **Pixels** (`arrange/frame.ts`). `desk.windows.move { window?, x?, y?, dx?, dy? }` and
  `desk.windows.resize { window?, w?, h?, dw?, dh? }` take CSS pixels from the desk's top left, a point
  or a size, or a step; an axis left out stays; an axis given both ways is refused. A resize keeps the
  top left corner. `desk.windows.fill { window?, fill }` snaps to a half or a quarter, maximizes
  (`full`) or comes back (`none`: to the place and mode the fill kept, desk-wm's `unfilled`, sent as
  `set-geometry`). Each runs as `Wm::run` (`move`, `resize`, `snap`), then waits for the desk it made:
  an empty batch of edits asked next, and, since the app's shell takes each page call on a thread of
  its own and that batch can overtake the command, the window's change in the store, at most 400 ms
  more (`LATE_MS`) when the command changed nothing.
* **The rest of a window** (`arrange/control.ts`). `desk.windows.float { floating }`,
  `desk.windows.pin { pinned }`, `desk.windows.bring-back` (from the drawer),
  `desk.windows.move-to-desktop { desktop }` (an id, a name, a position from 1, or `new`),
  `desk.windows.new`, `desk.windows.split { pane?, dir }` and `desk.windows.close-pane { pane }`, each
  through what the title bar, the drawer or the desktops run.
* **Answers.** Every one answers where the window ended up and how it is placed (`Frame`: x, y, w, h,
  state, fill, floating, pinned, desktop), as desk.windows.list would say it, so the agent sees what the
  window manager's rules did.
* **Which window.** The one named, else the one in use, on the desktop in front; one on another desktop
  or out of the canvas is refused with the desk's words (desk.windows.focus or desk.windows.dock first),
  except move-to-desktop, which takes a window from any desktop.
* **Permissions** are those of any agent command (ADR 0072, ADR 0089): Eris is asked once per tool for
  `agent:eris`, within `agents.eris.allow`. None of them is irreversible.

### Consequences

* Good, because every function of a window is a tool, in the pixels Eris reads, answered in the same.
* Good, because no window manager code changed: keys, drags and agents keep one set of rules, and the
  motion gate (ADR 0208) is untouched.
* Bad, because ten more desk tools crowd a turn: past 32 the core offers the desk's own commands after
  the plugins' (ADR 0109), so on a busy desk Eris finds them through desk-tools and runs them with
  desk-run, two steps more. Keeping desk.windows.* in every turn is a change to `core_tools.rs` still
  to make.
* Bad, because a move or resize of an agent's is not on the desk's undo stack (ADR 0077): "undo that"
  is another move.
* Bad, because a placement takes two round trips to the compositor (the command, then the empty batch),
  a command that changes nothing answers 400 ms late, and a whole frame needs a move and a resize,
  which is two of a turn's twelve calls.

### Confirmation

`arrange/frame.test.ts` and `arrange/control.test.ts` on desk-wm as WebAssembly (each command, its
refusals, no toggles, the answers, a command the host runs late or not at all, every command offered
to agents with a schema that compiles), and
`packages/runtime/e2e/window-control.spec.ts` in the shell page (the answer, the window's box in the
page and desk.windows.list say the same pixels).

## More Information

Builds on ADR 0088, 0089, 0109, 0124, 0128, 0132 and 0153. `docs/ko/desk-structure.md`'s window manager
and Eris sections can name these commands among Eris's tools when they are next revised.
