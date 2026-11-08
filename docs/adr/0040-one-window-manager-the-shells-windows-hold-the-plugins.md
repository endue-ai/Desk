---
status: accepted
date: 2026-10-31
decision-makers: Team endue
---

# One window manager: the shell's windows hold the plugin surfaces

## Context and Problem Statement

Desk had two window models (ADR 0025, "Consequences"). The runtime's compositor laid plugin surfaces
out on a CSS grid (`packages/runtime/src/layout.ts`, `surfaces.ts`): cells, no drag, no resize, no
z-order. The shell had floating windows (`packages/runtime/src/surface`): drag, resize, pin, panes
and splits, the drawer, saved per desktop in a profile. But a shell window could only show the shell's
own sample views, so in the app every plugin sat in a fixed grid under a shell whose windows showed
samples of the same things (#149). Which window system stays, and where do moving, resizing and the
interactions between windows live?

## Decision Drivers

* One window manager, and one that holds the plugins, since the plugins are what the desk shows
* The Rust core keeps primitives and data (which surfaces exist, whose they are, where they were);
  pixels, hit testing and the pointer are the web runtime's (design rule 1, the OS analogy)
* A plugin's frame is sandboxed and cannot hold another plugin's surface, so windows stay host code
  (ADR 0026)
* A plugin keeps its state through a move, a resize, a pin or a focus change
* The bare runtime pages (`packages/runtime/e2e/fixture`) keep working for the runtime's own tests

## Considered Options

* The shell's windows hold the plugin surfaces; the grid stays only where there is no shell
* Make the grid the window manager: give cells drag, resize and z-order
* Move the shell's windows into the core as `ui.window.*` methods

## Decision Outcome

Chosen option: "the shell's windows hold the plugin surfaces", because the shell's windows already
have everything a window needs and the grid has nothing but cells, and because window management is
a web runtime concern, not a core one.

* `createRuntime` takes a window host (`windows`): a centre or floating surface's section is created
  detached and handed to the host, which places it in a window's pane; edges and overlays stay the
  runtime's. The shell is that host (`packages/runtime/src/surface/host.ts`): the pane's view is
  `plugin:<id>`, and a placement whose `plugin` names a mounted UI plugin shows it (Morning's
  `calendar` shows `endue.calendar`, not a sample).
* Surfaces no profile places are tiled in the free area in mount order (`surface/tiling.ts`) and are
  not in the layout until the person moves, resizes, pins or splits one; then the window enters the
  session layout as it was and the dirty dot shows.
* Basic window management on top of drag and resize: a drop within 24 px of the free area's left or
  right edge snaps to that half and one at the top fills it (`surface/snap.ts`); a double-click on
  the title bar fills the area and again restores (`restore` on the placement);
  `desk.display.maximize`, `snap-left` and `snap-right` do the same for the focused window; frames
  take no pointer events while anything is dragged; new agent screens cascade.
* Focus and buffers stay one. A plugin pane is the runtime's surface, not a second host view: focus
  cycling and the buffer list see it once; clicking in the frame focuses its window without taking the
  focus out of the frame; closing the window unmounts the plugin for the session, as `Mod+W` did.
* A window is rebuilt only when the language changes; a pin or a focus updates it in place, so the
  frame is never re-parented then. Splitting or closing a pane, the drawer and a profile switch do
  re-parent it, which reloads the frame; the SDK's kept state covers that.
* The grid stays for a runtime without a window host: the e2e fixture pages without the shell.

### Consequences

* Good, because every plugin window moves, resizes, snaps, pins and goes to the drawer the same way,
  and agents reach the same through `desk.display.*` commands.
* Good, because the core needed no change: placements are still the shell's setting and session.
* Bad, because the grid and the windows still coexist in the code, the grid for the fixture pages;
  folding the fixtures onto the shell would let it go.
* Bad, because a pane re-render reloads a plugin's frame; a frame that keeps no state through
  `desk:state` loses it on a split.

## More Information

Amends ADR 0025 (its open consequence). ADR 0026 still governs where the shell's other parts go;
ADR 0028 the edges, which stay the runtime's bars. `docs/qa/TESTING.md` (Unit, Runtime: the shell);
`packages/runtime/e2e/shell-plugins.spec.ts`. Drag and drop of data between plugins, keyboard moving
of windows and tearing a window into a native OS window are later tasks.
