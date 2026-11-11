---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0128 (resizing a filled window leaves it floating) and ADR 0082 (normal windows go
anywhere on the canvas).

# A window's title bar stays within reach, and a window out of a fill is in its own mode

## Context and Problem Statement

The QA pass of 2026-11-11 (#159) found windows the pointer could not take again. A window dropped
with its title bar under the dock could not be picked up: the dock lies above every window and
hears the presses there (ADR 0167), and the bottom snap band starts only 24 px from the edge, so the
58 px under the dock were a legal drop (finding 4). A window grabbed inside an edge's snap band aims
at no snap (ADR 0128's intent rule), and nothing else held it: dragged out of the app, or moved by
`desk.display.move-*` thirty times, it ended wholly outside (finding 7). A snapped window resized by
a grip stayed floating at its snapped height, 800 px tall and clamped to the app, and never took its
own place back (finding 10). And a three-pane window at the window minimum had panes 58 px wide
whose close button was cut off (finding 19). Where may a window be left, and what is a window
after a resize ends its fill?

## Decision Drivers

* The person can always take a window again by its title bar, with the pointer
* While the pointer holds a window it follows the pointer anywhere, as before
* Coming out of a fill gives back the window the person had (ADR 0128's own driver)
* No new state in the layout; the page keeps laying panes out by their ratios

## Considered Options

* Keep the title bar within reach on every drop and move command; a fill left by a resize or a step
  returns to the window's own mode; each pane keeps a minimum
* Clamp a normal window whole into the app, as a floating one is
* Leave windows where they are dropped and let the canvas map, a pan or Tile bring them back

## Decision Outcome

Chosen option: "keep the title bar within reach", because it keeps the canvas (a normal window may
still lie mostly outside the app) and only refuses the places the pointer cannot reach.

* **Within reach** (`desk_wm::reach`): a drop by the title bar, a `desk.display.move-*` step and a
  resize by a top grip leave the window's title bar inside the app from its top to its bottom line,
  at least 48 px of the stretch that drags it in sight at the left or right edge, and clear of the
  edge bars' surfaces (the dock, wider than tall): a title bar that would lie under one goes above
  it (below it for a bar at the top). The window glides there from where it was let go. The shell
  hands the window manager the edge bars and the system layer's parts with every report.
* **Out of a fill** (`desk_wm::own_floating`): resizing a filled window by a grip, or moving or
  resizing it by a step, ends the fill where it is, in the mode the window had before it filled
  (`restore.floating`): a normal window snapped and resized is on the canvas again; one that floated
  floats. Dragging it out by its title is unchanged.
* **Room for each pane** (`desk_wm::pane_min`): a pane keeps at least 120 × 80 px, its header and
  close button included; a window's minimum is its panes'. A grip and the step command stop there; a
  resize, a divider's drop and a split move each split's ratio as little as it takes, and a split
  that leaves a pane less grows the window.
* **A drag is no double-click** (`shell/drag.ts`): the page swallows the double-click a drag's
  release ends, as it swallowed its click, so a press soon after a click on a title bar, dragged,
  leaves the window where it was dropped instead of maximizing it (finding 11). The window manager
  cannot tell that maximize from the keys' or the palette's, which name the window in use too.
* **Cursors** (`desk_wm::interact::cursor`): the window manager names the cursor where it runs what
  a press starts (each grip's resize cursor, a grab hand over the title, grabbing while held), which
  the shell shows over the surface's own (finding 13).

### Consequences

* Good, because no drop, step or resize leaves a window the pointer cannot take again.
* Good, because a snapped window resized is the window the person had, at its new size.
* Good, because a pane's header and close button always show, however small the window.
* Bad, because a window can no longer be parked under the dock or mostly off the top: the drop
  moves it back. A normal window can still go far off the sides and the bottom but for its title.
* Bad, because a window of many panes cannot be made as small as one of one pane.
* Neutral: layouts saved with windows out of reach keep loading; the next drop or step brings them
  within reach. Ratios a fit moved are stored as they are, not rounded.

## More Information

Issue #159 (findings 4, 7, 10, 11, 13, 19). `crates/desk-wm/src/reach.rs`, `pane_min.rs`,
`interact/{pointer,ops,cursor,gesture}.rs`; `apps/desk/shell/src/compositor_window/{hosted,cursor,wm}.rs`;
`packages/runtime/src/shell/drag.ts`. Tests: `crates/desk-wm/tests/interactions/{reach,cursor,panes}.rs`,
`tests/panes.rs`, `packages/runtime/src/shell/drag.test.ts`; app e2e `e2e/specs/windows-reach.spec.ts`,
`windows-snap.spec.ts`. `docs/architecture.md` does not describe window modes, so it does not change.
