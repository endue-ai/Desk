---
status: accepted
date: 2026-11-13
decision-makers: Team endue
---

Supersedes ADR 0140 (a wgpu compositor over CEF off-screen surfaces) and ADR 0156 (the compositor is
the only desk) as the desk's default. The ADRs that follow from them (0149 to 0202: the compositor,
the window manager, the frame clock) stay as the record of code this one freezes. Amends ADR 0093
(the mission stays; the order of the milestones changes) and ADR 0121 (Eris over the OS becomes the
island).

# The OS owns the screen and endue owns the workspace

## Context and Problem Statement

Since ADR 0140 (2026-11-10) the desk has been one OS window in which `desk-wm` places every window
and a wgpu compositor draws it from an off-screen Chromium page. In the three days after, 140 of 425
commits were fixes, and eight ADRs patched the frame clock alone. Measured on 2026-11-13 (`main`
4e140552, thirteen plugin windows, a 1x display, a window shaken at 2 Hz): 39.7 frames a second in the
development build and 58.0 optimized; in the optimized build one frame in four still showed another
window's pixels; the desk's page stopped painting until a restart in two of five optimized runs; a
window dropped at a fractional place stayed blurred. Each is a thing an OS's window manager settles for
every app: a window's place and its picture change in one commit. ADR 0201 and ADR 0202 landed after
the measurement and narrow two of them; the cause, a desk that guesses when a page's picture has caught
up with a window, stays.

What a person asked of endue was never a way to draw windows. It is a place to work: the tools they
make, their agents, their connections and what Eris remembers, used every day beside the OS's own apps.
A frame cannot hold those apps. What does endue own on a person's computer?

## Decision Drivers

* A person's work lives among the OS's apps: an endue window must stand beside them, on any display,
  in the OS's own switcher
* Daily use first: a desk a person cannot work without, before a screen of its own
* The effort goes where endue differs from an OS vendor's assistant: tools a person makes and owns,
  any OS, open plugins
* No guess between a window's place and its picture
* Keep what works: the runtime, the bridge, grants, the core, the plugins, the shell's OS services
* One OS stays the end state; only the order changes

## Considered Options

* Keep the compositor desk and go on fixing it (ADR 0140, 0156, 0201)
* OS windows: endue is a hub with an island, a home and apps in OS windows of their own
* A voice assistant alone: the floating Eris and nothing that stays on screen
* A static app: one window with fixed screens

## Decision Outcome

Chosen option: "OS windows", because it gives up only what the OS already does well and puts every
window a person makes on the same footing as the apps they already use.

* **The screen is the OS's.** endue places, composites and focuses no window. `desk-wm`,
  `desk-compositor`, the compositor window and the off-screen web host are frozen: no new work but a
  fix a person on `main` cannot work without, and they leave the default build once app windows hold
  what the desk held. They come back only for a screen of endue's own (a full-screen mode, a device).
* **endue is the hub.** A resident core that needs no window: apps, agents, connections (connectors,
  MCP), memory, the index, grants and their log. It starts at login and stays when every window closes.
* **An app is a Chromium web app in an OS window of its own.** What was a plugin's surface is a
  windowed browser with its own renderer, in the folder format plugins have today (rule 9), built in
  or made by a person. endue is the app that makes apps: Eris writes one from a sentence, it is a
  folder in the desk folder, it opens as a window, and it can be pinned, versioned and exported.
* **The island** is one small surface floating anywhere on the desktop, over every app: what the
  agents are doing, what waits for an answer, the workspace in use. It opens to talk or type to Eris
  and to call up an app. It takes the place of the floating Eris and of the tray's status.
* **Home** is an ordinary window: apps, agents, workspaces and settings at a glance.
* **The workspace is the unit endue owns:** the apps of one piece of work and where their windows
  stood, its agents, its connections, the OS's own apps it used and their places, what was decided and
  what is left. It is set up in one go (a pack), saved and recalled, and it is a file in the desk
  folder a person can export.
* **The order:** a place (hub, app windows, home, island), then making and owning apps, then
  workspaces, then every OS, and only then, by choice, a screen of endue's own.

### Consequences

* Good, because moving, resizing, focus, the input method, accessibility and drag and drop are the
  OS's and Chromium's own again, and a window never shows another's pixels
* Good, because a windowed browser runs Chromium's own frame scheduling: the frame clock, its
  thresholds and the stalls of ADR 0152 to 0202 go with the off-screen pages
* Good, because about 39,000 lines of Rust (`desk-compositor`, `desk-wm`, the compositor window, the
  off-screen web host) and about 7,000 of TypeScript (the runtime's window manager) leave the default
  build
* Good, because the pieces exist: windowed panes (`pane.rs`), floating windows (`float.rs`), global
  shortcuts, the tray, computer use, start at login in `desk-sys`
* Bad, because the canvas, desktops, the spread, the map, snapping, panes and splits inside a window,
  and one look on every OS go until endue has a screen of its own
* Bad, because every OS needs an adapter (windows, a floating panel, shortcuts, permissions,
  automation of other apps), and a Wayland session limits where a window may place itself
* Bad, because a renderer per app window costs memory: the live budget of ADR 0142 is decided again
* Bad, because without a frame endue is seen only through the island and home, which must earn their
  place in a day
* Bad, because the app e2e and the performance gates that drive the compositor are written again, and
  native plugins (ADR 0154), which only the compositor draws, need a window of their own or wait

## More Information

The migration and its order: #232 (steps #233 to #240). The measurements come from a trace added for
that day (`DESK_FRAME_TRACE`, not merged). Both roadmaps (`docs/ko/desk-roadmap.md`, `docs/roadmap.md`)
take the new order with this page, and `AGENTS.md` names the frozen paths. `docs/ko/desk-structure.md`
(the shell, the surfaces and the window manager's sections) and `docs/architecture.md` with its five
translations describe the desk as it is built, so they change with the code: home with no compositor
window (#236), the app format (#239), the compositor out of the default build (#240).
