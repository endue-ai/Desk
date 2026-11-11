---
status: accepted
date: 2026-11-03
decision-makers: Team endue
---

Status: amended by ADR XXXX: the window in use is on top of every window, a floating one too, and
the others stack in the order of use; floating windows stay above the normal ones not in use.

# Windows are normal on the canvas by default; floating windows stay put above them

## Context and Problem Statement

A shell window (ADR 0040) is either on the desktop's canvas, moving with its pan, or anchored to the
app's viewport. The flag (`SurfacePlacement.floating`) defaulted to anchored, so every window, saved
layouts and profiles included, ignored the pan unless the person switched it. A plain drag on the
empty background panned, which also turned stray drags into pans. Which mode is the normal one, how
does the person pan, and how do the two kinds stack?

## Decision Drivers

* The desk is a canvas: the windows the person works in should move with it
* Some windows (a reference, a player) must stay in sight whatever the pan
* Panning must be deliberate and must work even when windows cover the background
* Saved layouts must keep loading

## Considered Options

* Normal (canvas) by default, floating by choice; Shift + drag pans; floating above normal
* Keep floating by default and only change the pan gesture
* One mode only: every window on the canvas

## Decision Outcome

Chosen option: "normal by default, floating by choice", because the canvas is the desk's model and
floating is the exception the person asks for with the title bar's Floating button.

* `floating` absent or false is normal mode: world pixels on the desktop's canvas, moved by its pan,
  never resized with the app. `floating: true` is floating mode: the 1440×900 frame, mapped onto the
  app whatever the pan, shrinking with it axis by axis.
* Shift + drag on the empty background or on a title bar pans; a plain drag never does. The wheel over
  the empty background still pans.
* Floating windows stack above every normal window, focused or pinned (`zOf`), since the canvas
  moves under them.
* New windows, and plugin windows when they arrive, open in sight: their place on screen at the
  current pan becomes their canvas position.
* Maximize and snapping work in both modes: a normal window fills what is in sight and stays there on
  the canvas; a floating one keeps filling the app (`fill`).

### Consequences

* Good, because windows behave like objects on one canvas and floating ones like overlays above it.
* Good, because a stray drag on the background no longer moves the desk.
* Bad, because saved layouts without the flag change meaning: their windows were mapped from the
  1440×900 frame and now sit at those coordinates on the canvas, so on a larger app they open closer
  to the top left, and they no longer shrink with a smaller app.
* Bad, because panning needs a modifier key; there is no touch gesture for it yet.

## More Information

Amends ADR 0040 (one window manager). `packages/runtime/src/shell/Pan.ts`,
`packages/runtime/src/surface/coordinates.ts`, `packages/runtime/src/surface/cover.ts`;
`packages/runtime/e2e/shell-canvas.spec.ts`. `docs/ko/desk-structure.md` and `docs/architecture.md`
do not describe window modes, so neither changes.
