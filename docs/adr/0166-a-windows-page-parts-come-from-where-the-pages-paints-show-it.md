---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0153 (what the page draws of a window is taken from where its paints show it, not from
where its report lays it out) and ADR 0160 (the page's open overlays are one more part).

# A window's page parts come from where the page's paints show it

## Context and Problem Statement

The compositor draws what the page draws of a window (its title bar's icon and tools, its own
views such as a local agent's screen, split panes' headers) by cutting it out of the page's one
texture where the page's report says it lays the window out (`host::Places`, ADR 0153), and draws
the rest of that texture above every window as the system layer (ADR 0160). The report reaches the
desk as soon as the DOM has the window there, on the bridge's thread, and the texture shows it a
frame or two later; in a fast drag the two never agree. Measured on a drag of Claude Code's screen
8 ms a step: the window's place in the texture lagged its report by one to ten steps, so the
window was cut from where the texture had other windows' titles and the Eris rail, and its old
picture stayed above every window where the texture still had it (the trails of the person's
screenshots). Paints often came before the report that laid them out (8 ms in the trace). And the
rail's popovers, menus and dialogs were cut by windows' titles and by windows over other windows,
as they were not parts. How does the compositor cut a window from where the texture has it?

## Decision Drivers

* A window never shows another window's pixels, and leaves no picture of itself behind
* No new protocol: the page's paint already carries its damage (`specs/surface`, `attach`)
* The pointer on a window's parts still reaches the DOM where the window is now

## Considered Options

* Follow the picture by the paints' damage: a reported layout waits until the damage of the paints
  since it (a paint up to 40 ms before its report counts) covers every pixel the change moves
* Mark each paint with the report it shows (a pixel the page draws, read back from the texture)
* Freeze the page's layout of a window while a gesture holds it, and move a copy

## Decision Outcome

Chosen option: "Follow the picture by the paints' damage", because the damage says exactly which
pixels a paint changed, with no read-back and no frame of latency, and it serves every change the
same way: a drag, a resize, a glide, a window opened, closed or moved to another desktop.

* **`desk_wm::PageShown`** (`crates/desk-wm/src/host/shown.rs`) keeps, per window, the layout the
  texture shows and the layouts reported since; each paint's damage moves a window on to the newest
  layout whose change it covers, counting the paints since the window was last confirmed. A page
  quiet for 150 ms has painted what it laid out. A window the picture does not show yet is drawn
  without its parts (its frame only); the parts of a window gone stay out of the system layer
  until a paint clears them (`Places::{unpainted, stale}`).
* **Input** goes where the DOM has the window: a part drawn from the picture's place hears the
  pointer at the DOM's (`Places::heard`, `HostWindow::heard`).
* **Never past the texture**: a part is cut to what the page's texture holds, so a texture not
  grown to a new size yet leaves the window's fill there, never the edge's pixels stretched in
  stripes.
* **Overlays are a part** (`desk.overlays`): each open popover, menu, hover title and dialog box,
  one box each, drawn whole above every window as the bars are.

### Consequences

* Good, because a window drags, resizes and glides with its own pixels only, and nothing of it
  stays behind; one opened or closed shows no garbage for the frames before the page paints.
* Good, because the rail's popovers and the page's menus and dialogs are never cut by a window.
* Bad, because a part of the system layer drawn whole (Eris, a bar) over a window that moves ahead
  of the page still shows the page's pixels under it, the window's last painted place, until the
  page catches up.
* Bad, because a damage merged into a large box may confirm a layout a frame early, and a page
  that pauses for more than 150 ms mid-gesture is taken as painted: one frame of the old cut.

## More Information

Issue #157's trails and the person's report of 2026-11-12 (drags, resizes, Floating mode, scroll).
Amends ADR 0153 and ADR 0160. Code: `crates/desk-wm/src/host/{shown,mod}.rs`,
`apps/desk/shell/src/compositor_window/{hosted,hosted_picture,composed,draw}.rs`,
`apps/desk/src/compositor-system.ts`, `crates/desk-web/src/sender/system.rs`. Tests:
`crates/desk-wm/src/host/shown_tests.rs`, `apps/desk/src/compositor-system.test.ts`. No section of
`docs/ko/desk-structure.md` changes.
