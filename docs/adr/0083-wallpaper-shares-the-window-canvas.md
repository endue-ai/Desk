---
status: accepted
date: 2026-11-03
decision-makers: Team endue
---

# Wallpaper and normal windows share one canvas

## Context and Problem Statement

ADR 0082 makes normal windows follow the desktop's pan, while Floating windows stay in view.
The canvas grid replaced the theme's backdrop as soon as a normal window opened. People need a
continuous desk underneath their windows, a choice of wallpaper, and live scenes that react to work.

## Decision Drivers

* Scenery and normal windows must move by the same number of world pixels
* Existing themes, window modes, saved layouts and plugin surfaces must keep working
* Live scenes must respect reduced motion and avoid running unseen

## Considered Options

* Built-in procedural scenes using the existing shell clock and personal preferences
* Remote wallpaper downloads or a new executable wallpaper plugin contract
* Keep the viewport background and add a parallax effect

## Decision Outcome

Choose built-in procedural scenes: Theme, Grid, Pond and Aurora. The core's string setting
`desk.wallpaper.scene` uses the existing version 1 personal preferences record and its choice
validation. Settings > Appearance selects it; no public wire format changes.

With the shell's window host, `left` and `right` placement hints join the same window manager as
centre and floating surfaces: normal by default, freely movable and resizable, Floating by choice.
They participate in buffers and offscreen frame unloading. The standalone grid runtime retains
edge bars, and overlay surfaces and the bottom dock keep their existing roles.

Wallpaper tiles and interaction effects use the normal windows' per-desktop pan, including on an
empty desk. A newly visible window creates a Pond ripple at its visible centre converted to world
coordinates. Moving, focusing or changing a window's Floating mode creates no extra ripple.
Effects are bounded to sixteen, expire after 3.2 seconds, and clear when the scene or desktop changes.
Live updates use the injected ticker, capped at 30 fps, and unsubscribe while hidden or reduced.

The three-state Eris bar wraps the existing composer, preserving its send, command and IME behavior.
Hover previews directory agents; click or Option/Alt + Space opens input. Its agent picker opens
the existing agent screens and does not change the conversation's recipient.

### Consequences

* Good: the desk has continuous scenery, with no network dependency or extra permissions.
* Good: existing normal/Floating windows and theme tokens provide the shared coordinates and colors.
* Bad: wallpaper scenes are built in; custom images, video and third-party renderers need later work.
* Bad: Theme images that do not repeat can reveal the base color when panned beyond their edge.

## More Information

[#429](https://github.com/endue-ai/Desk/issues/429), ADR 0082, `packages/runtime/src/wallpaper/`,
`packages/runtime/e2e/desk-wallpaper.spec.ts`. The design summary does not describe wallpaper or
window modes, so `docs/architecture.md` and `docs/ko/desk-structure.md` need no change.
