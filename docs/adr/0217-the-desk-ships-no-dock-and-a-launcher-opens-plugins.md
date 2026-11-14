---
status: accepted
date: 2026-11-14
decision-makers: Team endue
---

Amends ADR 0028 (the desk's edges: the bottom edge has no plugin of the desk's own over it) and ADR
0104 (`role:dock` stays, with no built-in provider).

# The desk ships no dock, and a launcher opens plugins

## Context and Problem Statement

The bottom dock (`endue.dock`) was a row of tiles along the app's bottom edge, one for each plugin
that opens on the desk: a tile opened its plugin, brought its window forward or put it away. On the
Default profile it lay over the bottom of every window snapped or grown to that edge, and it showed
dozens of plugins in a row that scrolled. The palette opens every plugin as well: `Mod+K` in the
desk, `Cmd/Ctrl+Shift+Space` and the tray's Search Desk from anywhere, and with nothing typed it lists
what was opened lately, then every plugin (`plugins/palette`). The person asked for the dock to go and
chose how plugins open instead from four ways drawn for them: first the palette alone, then, the same
day, the launcher grid. What opens a plugin on a desk with no dock?

## Decision Drivers

* Nothing stays over the canvas and its windows for opening plugins
* Every plugin in sight at once, for a person who does not know a plugin's name to type
* A way in that shows on screen, not only a key
* The tests of the bottom edge (an edge bar windows keep clear of, ADR 0182, ADR 0183, ADR 0198) keep
  their subject

## Considered Options

* The palette alone: no new surface; with nothing typed, Recent, then Plugins
* A launcher grid over the whole app, opened by a button or a key
* A button on the left bar that unfolds pinned plugins and the whole list
* A small list at the pointer on a double press of the empty canvas, the plugin opening there

## Decision Outcome

Chosen option: "a launcher grid over the whole app", beside the palette, because it shows every plugin
at once to a person who does not know its name, takes no place on the desk while it is away, and
needs one button to be found.

* **The dock goes.** `plugins/dock` leaves the built-in plugins: it is not installed, packaged or
  listed, and the sample profiles name it no more. Its own tests and its runtime specs
  (`dock.spec.ts`, `dock-windows.spec.ts`) go with it. `role:dock` and the bottom edge stay in the
  spec and the runtime for a plugin someone makes; no built-in plugin fills the role.
* **The launcher** (`plugins/launcher`, `endue.launcher`) is a built-in plugin in the community
  format: a hidden overlay over the whole app with a field, a Recent row (what was opened from it,
  six at most, in its own store) and every plugin that opens on the desk, by name. Typing filters,
  the arrows move, Enter or a press opens with `desk.plugins.open` (which turns on a plugin that is
  off and brings a window under others forward), Escape or a press on the ground puts it away.
* **Where it opens from.** `endue.launcher.open`: a button at the top of the account bar at the bottom
  left, the one control on screen for it; `Mod+Alt+L`; and the palette, as any command. The account
  bar is one button taller (210 px), and the agent bar's room at small heights follows
  (`system.css`).
* **The palette is unchanged**: Recent, Plugins, then Commands when nothing is typed.
* **The dock's folder** moves to `e2e/fixtures/built-in/dock` under its id: the app e2e's driver
  installs that folder's plugins as built in beside `plugins/`, and the runtime's edges page serves
  it, so the specs of the bottom edge bar and of putting a surface away keep the plugin they were
  written on.

### Consequences

* Good, because a window at the app's bottom edge is covered by nothing of a plugin's
* Good, because every plugin is one press and one look away, and a name need not be known
* Good, because the launcher is a plugin on the public bridge: a person can replace it
* Bad, because the grid covers the whole app while it shows
* Bad, because there are two lists of plugins to open from, the launcher's and the palette's, each
  with its own Recent
* Bad, because putting a plugin away by one press is gone: its window's close button and the drawer
  remain
* Bad, because the app e2e runs with a bottom-edge plugin the desk does not ship: no app e2e looks
  at the Default profile's layout with nothing on that edge
* Bad, because the first run's tour still draws a dock in its frame (a follow-up)

## More Information

The four ways as drawn: the design canvas the person chose from (not in the repository). Checked on
the running desk (headless): the button and `Mod+Alt+L` showed the grid, "te" left Terminal, Computer
and Notes, Enter opened Terminal, which then led the Recent row, and Escape put the grid away. Issue
#276.
