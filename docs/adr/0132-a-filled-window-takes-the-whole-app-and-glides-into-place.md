---
status: accepted
date: 2026-11-09
decision-makers: Team endue
---

# A filled window takes the whole app, under the floating bars, and glides into place

## Context and Problem Statement

A maximized or snapped window filled the free area (PR #14, ADR 0128): between the side bars, the
rail, the bottom line and the top chips, and under Eris while she sat in her default place. At
1440 × 900 that left a maximized window 1232 × 622, a left half 610 px wide, with a band of empty
desk on every side that the window could never use. The person asked for the opposite: a floating
window that fills or snaps takes the whole window, and only the bars float above it. Dragging to an
edge also felt abrupt: the preview appeared at once inside the bars, far from the pointer at the
edge, and the window jumped into its part on the drop.

## Decision Drivers

* A filled window uses every pixel of the app
* The bars stay where they are and float above every window, as they already do over windows
  dragged or resized over them
* A filled window's title bar stays reachable: its title and tools are not under the top chips
* The drag reads as one motion, from the pointer to the part the window takes

## Considered Options

* The whole app, the title clear of the top chips (`surface/clearance.ts`), the window gliding
* Keep the free area (ADR 0128 as it was)
* The whole app with the bars hidden while a window fills it

## Decision Outcome

Chosen option: "the whole app, the title clear of the top chips, the window gliding", because it
gives the person the size they asked for and changes no bar.

* **Parts** (`shell/windows.ts`, `filled` and `snapRect`; `surface/coordinates.ts`): maximize, the
  title bar's double-click and the eight snaps take the whole app (`screenArea`) or its half or
  quarter, a 12 px gap between halves and quarters. Every fill still floats (ADR 0128). A fill stored
  while fills stayed in the free area draws over the whole app too: a fill is drawn from its name and
  the app's size, never from its stored rect, so `fillTop` goes.
* **Title clearance** (`surface/clearance.ts`, back from before PR #14): the windows' layer measures
  the profile switcher and the desktops into `--chrome-left` and `--chrome-right`; a window filling
  the app, its top half or a top quarter pads its title bar's start or end by them.
* **Gliding** (`surface/interactions.ts`, `settle`): a window whose fill changes (a snap on the drop,
  a maximize, a restore, from one part to another) glides there over `--motion-base` with the desk's
  easing; a filled window dragged away glides only its size back, so it never lags the pointer. The
  preview grows out of the dragged window's own box and glides from part to part. Reduced motion
  zeroes the `--motion-*` tokens, so nothing moves.
* Opening windows and arranging (tile, cascade, the spread; ADR 0116) keep the free area: those place
  windows the person did not ask to fill.

### Consequences

* Good, because a filled window gets the whole app: 1440 × 900 instead of 1232 × 622.
* Good, because the snap preview starts where the pointer is, and the window follows it there.
* Bad, because the side bars, the rail, the bottom line and Eris lie over a filled window's edges
  again (what PR #14 removed): a maximized Mail's mailbox list starts under the left bar.
* Neutral: layouts saved with free-area fills keep loading and simply fill the whole app.

## More Information

Amends ADR 0128 ("Parts": inside the free area) and ADR 0040 (a fill's area). PR #14 had made fills
keep clear of the bars; this takes that back at the person's request. `packages/runtime/src/shell/windows.ts`,
`packages/runtime/src/surface/{coordinates,clearance,interactions,snap}.ts`,
`packages/runtime/src/surface/surface.css`; e2e `shell-snap.spec.ts`, `shell-plugins.spec.ts`,
`shell-canvas.spec.ts`, `terminal-fit.spec.ts`, `unload.spec.ts`.
