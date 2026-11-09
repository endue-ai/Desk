---
status: accepted
date: 2026-11-09
decision-makers: Team endue
---

# Windows snap to halves at the app's edges and quarters at its corners, and a snapped window floats

## Context and Problem Statement

A window dragged by its title bar snapped only to the left or right half of the free area, or filled
it at the top (ADR 0040). Nothing showed where a drop would snap until the button was let go, the
bottom and the corners did nothing, and a snapped normal window stayed on the canvas (ADR 0082): a
Shift + drag pan carried it away from the place the person had just snapped it to. Where can a drag
snap, how does the desk tell a drag that aims at an edge from one that only passes near it, and
what is a snapped window afterwards?

## Decision Drivers

* Eight targets a hand finds without looking: the four edges and the four corners of the app
* A drag near an edge that is not aiming at it must not snap
* The person sees the result before letting go, and can still take it back
* A snapped window stays where it was snapped, whatever the pan
* Coming out of a snap gives back the window the person had

## Considered Options

* Edges to halves, corners to quarters, an intent rule and a preview; a snap floats the window
* Keep the top edge for filling the whole area, as before, and add the bottom and the corners
* A dwell time in a zone before it counts, instead of the intent rule

## Decision Outcome

Chosen option: "edges to halves, corners to quarters, an intent rule and a preview; a snap floats
the window", because it gives eight targets of one kind and keeps the snap where it was put.

* **Zones** (`surface/snap.ts`, `snapFor`): the pointer within 24 px of the app's left, right or
  bottom edge, or 8 px of the top, snaps to that half of the free area. The top band is narrow
  because windows are often moved up under the bars on purpose. Along an edge, the last 120 px
  before a corner (a quarter of the edge at most) belong to the corner's quarter. A pointer past the
  edge, outside a windowed app, counts as at the edge.
* **Intent** (`aimSnap`): the pointer has to reach a zone from inside the app. A drag that starts in
  a zone, such as a title bar grabbed on a window that sits at the top, aims at nothing until the
  pointer has left every zone once. Escape still cancels the whole drag.
* **Preview**: while the pointer aims at a zone, a translucent rect (`.surface-snap`, the primary
  soft and border tokens) shows the part the window will take, under the dragged window, and moves
  from part to part with the pointer.
* **Parts**: halves side by side or one above the other, quarters at the corners, a 12 px gap
  between them, inside the free area (ADR 0040, under the bars and Eris's place). A bottom part sits
  exactly a gap below the top one, so its stored rect tells the top of the area it came from.
* **A fill floats**: every fill (a half, a quarter, or the whole area by the title bar's double-click
  or the palette) sets `floating: true` while it lasts, so a pan leaves it in place and it keeps its
  part when the app is resized. `restore` keeps the window's own place and the mode it had
  (`restore.floating`); maximizing from a half or a quarter also keeps that part (`restore.fill`),
  and restoring comes back to it.
* **Coming out**: dragging a filled window away gives it back its own size and mode at once, under
  the pointer at the same share of its width; a normal window is on the canvas again. Resizing a
  filled window ends the fill where it is and leaves it floating. The title bar's Floating button
  takes it out of the snap as a normal window.
* The palette's `desk.display.snap-left` and `snap-right` take the same path, so they float too.

### Consequences

* Good, because every edge and corner snaps the same way, and the preview shows it before the drop.
* Good, because a snapped window stays put under a pan and comes back as it was when dragged out.
* Bad, because dragging to the top no longer fills the whole area; that stays on the double-click
  and the palette's Maximize.
* Bad, because a snapped window floats above every normal window (ADR 0082's stacking): a normal
  window under it cannot be brought in front of it until the snap ends.
* Neutral: layouts saved before this keep loading. A restore without `floating` keeps the window's
  own mode, and a normal window filled before keeps its world rect until it is filled again.

## More Information

Amends ADR 0040 (snapping) and ADR 0082 ("Maximize and snapping work in both modes"). Issue #19.
`packages/runtime/src/surface/snap.ts`, `packages/runtime/src/surface/interactions.ts`,
`packages/runtime/src/shell/windows.ts`, `packages/runtime/src/surface/coordinates.ts`;
`packages/runtime/e2e/shell-snap.spec.ts`. `docs/architecture.md` does not describe window modes or
snapping, so it does not change.
