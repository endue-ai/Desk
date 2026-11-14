---
status: accepted
date: 2026-11-14
decision-makers: Team endue
---

Amends ADR 0028 (the desk's edges: the bottom edge has no plugin of the desk's own over it) and ADR
0104 (`role:dock` stays, with no built-in provider).

# The desk ships no dock, and the palette opens plugins

## Context and Problem Statement

The bottom dock (`endue.dock`) was a row of tiles along the app's bottom edge, one for each plugin
that opens on the desk: a tile opened its plugin, brought its window forward or put it away. On the
Default profile it lay over the bottom of every window snapped or grown to that edge, and it showed
some sixty plugins in a row that scrolled. The palette already opens every plugin: `Mod+K` in the desk,
`Cmd/Ctrl+Shift+Space` and the tray's Search Desk from anywhere, and with nothing typed it lists what
was opened lately, then every plugin (`plugins/palette`). The person asked for the dock to go and chose
how plugins open instead from four ways drawn for them. What opens a plugin on a desk with no dock?

## Decision Drivers

* Nothing stays on screen for opening plugins: the canvas and its windows have the whole app
* One way a person learns once, that works for sixty plugins as for six
* No new surface to draw, place and keep clear of windows (ADR 0205's rule for the compositor)
* The tests of the bottom edge (an edge bar windows keep clear of, ADR 0182, ADR 0183, ADR 0198) keep
  their subject

## Considered Options

* The palette alone: no new surface; with nothing typed, Recent, then Plugins
* A launcher grid over the whole app, opened by a key or a button
* A button on the left bar that unfolds pinned plugins and the whole list
* A small list at the pointer on a double press of the empty canvas, the plugin opening there

## Decision Outcome

Chosen option: "the palette alone", because it is already there, holds every plugin and what was used
lately, and leaves nothing on the screen.

* `plugins/dock` leaves the built-in plugins: it is not installed, packaged or listed, and the sample
  profiles name it no more. Its own tests and its runtime specs (`dock.spec.ts`,
  `dock-windows.spec.ts`) go with it.
* The palette is unchanged: Recent, Plugins, then Commands when nothing is typed; a plugin that is off
  or closed opens from it, and one under other windows comes forward.
* `role:dock` and the bottom edge stay in the spec and the runtime: a plugin someone makes can sit
  there. No built-in plugin fills the role (`roles.test.ts`).
* The dock's folder moves to `e2e/fixtures/plugin-dock` under its id: the app e2e's driver adds it to
  every spec's dev plugins, and the runtime's edges page serves it, so the specs of the bottom edge
  bar and of putting a surface away keep the plugin they were written on.

### Consequences

* Good, because a window at the app's bottom edge is covered by nothing of a plugin's
* Good, because there is one list of plugins, searched and ordered by use, instead of two
* Bad, because a person who never presses `Mod+K` and never opens the tray sees no way to open a
  plugin: the first run must say it (the tour still draws a dock in its frame; a follow-up)
* Bad, because putting a plugin away by one press is gone: its window's close button and the drawer
  remain
* Bad, because the app e2e runs with a bottom-edge plugin the desk does not ship: no app e2e looks
  at the Default profile's layout with nothing on that edge

## More Information

The four ways as drawn: the design canvas the person chose from (not in the repository). Issue #276.
