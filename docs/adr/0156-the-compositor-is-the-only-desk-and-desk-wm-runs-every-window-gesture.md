---
status: accepted
date: 2026-11-10
decision-makers: Team endue
---

Status: amended by ADR 0158: `desk-wm` holds the window manager's state too; the runtime sends it
edits and keeps only the desk it publishes, and a desk without the compositor runs `desk-wm` as
WebAssembly. Amended by ADR 0160: what stays web runs as system surfaces the compositor places (the
desk's page, the palette's and Eris's windows), the page keeps no stand-in frame, and the CSS grid
(`layout.ts`) is deleted; `edges.ts` stays for the dock's bar and a runtime without a window host.

# The compositor is the only desk, and desk-wm runs every window gesture and command

## Context and Problem Statement

Since #81 and #80 (ADR 0151, ADR 0153) compositor mode placed every window from `desk-wm`, drew its
chrome, kept the live budget and ran the window gestures and commands on the compositor's input.
It was a mode (`DESK_COMPOSITOR=1`): without it the desk was Stage 1's windowed one, whose page drew
every plugin as one of its own frames and whose runtime moved, resized, snapped, panned and glided
windows itself. Every window gesture existed twice, in TypeScript and in Rust, and every app spec ran
on both desks. #83 is the switch of #53 (epic #32 §5): Stage 2 ends only when no DOM composites a
plugin surface. Does the windowed desk stay as a fallback, and what of the runtime's window manager
goes with it?

## Decision Drivers

* No DOM composites plugin surfaces (Stage 2's exit)
* One window manager runs each gesture and command: `desk-wm`, tested on the CPU and by the app e2e
* The runtime keeps its policies, commands, the plugin host, settings and the session's record
* A desk that opens on every machine, with or without a usable GPU
* What stays web (the bars, menus, the palette, Eris, notices, settings, the shell's own views) draws in
  the page as before, until system surfaces (#55)

## Considered Options

* The compositor is the only desk; the windowed desk is deleted outright
* The compositor is the default, and `--windowed` keeps Stage 1's desk for one release
* Both desks stay, the compositor opt-in

## Decision Outcome

Chosen option: "the compositor is the only desk", because the windowed desk was the runtime's
window manager's only user: a fallback for one release would keep every module this change deletes,
the second run of every app spec and a desk that composites plugins in its DOM, and a revert is as
quick a way back.

* **Shell.** The main window is always the compositor's wgpu scene with the page off screen;
  `DESK_COMPOSITOR` and `--compositor` are gone. What only the windowed main window used goes: the
  DevTools frame-target watch for renderer deaths (each surface's own browser reports its death,
  ADR 0149), the windowed browser's OS drag handler (OS drops go through the compositor's broker,
  ADR 0150; a drop nobody takes opens through the opened files' queue). Without a GPU adapter the
  compositor asks the backend for its software one (WARP, lavapipe) rather than open no desk.
* **Page.** `apps/desk` always runs the seam (ADR 0151, ADR 0153): it publishes the runtime's desk,
  carries out the live set and takes desk-wm's changes, and native plugins (ADR 0154), which only the
  compositor draws, mount on every start. Its own follow of an OS drag goes.
* **Runtime.** The window manager host is the only way a window moves by gesture or command: the title
  bar, the eight grips and Shift + drag tell it what a press starts, the title bar's double-click and
  the `desk.display.*` window commands run there, and its changes come back through `takeWm`. A desk
  without the compositor (the runtime's tests and fixture pages) gets `noWindowManager`, which moves
  nothing. Deleted: the runtime's drag, resize, snap aim, snap preview and glide
  (`surface/interactions.ts`, `resizeRect`, `snapFor`, `aimSnap`, the preview's and glides' CSS), its
  maximize, snap, move and resize (`windows.ts`, `runWindowOp`), its Shift + drag pan and its
  `desk:native-drag` listener. desk-wm's `tests/fill.rs`, `snap.rs` and `interactions.rs` are their
  ports.
* **What the runtime still keeps, and why.** The window manager's state stays the runtime's store,
  written by its own non-gesture operations (open, close, focus, panes, the drawer, desktops,
  profiles, tile, cascade, the spread's model) and by desk-wm's published changes; desk-wm mirrors it
  whole (ADR 0151). Moving those writes into desk-wm needs every caller of them to wait for the
  shell's answer, and the runtime's own e2e to run on the shell; that is a change of its own. The page
  still lays its window parts out (the title bar's icon and tools, its own views, the panes' headers)
  until system surfaces (#55), which also delete the CSS grid of a runtime without a window host
  (`layout.ts`) and give the edge bars (`edges.ts`) a surface of their own. The live budget is desk-wm's
  in the app; the runtime's own decision is left for desks without the compositor. `buffers.ts` is the
  plugins' buffer list (`desk.buffers.*`), a policy, not the window manager.
* **Tests.** Every app spec runs on the compositor; the `windows-*` specs are the window manager's
  parity. The runtime e2e that drove the DOM window manager's gestures went where their twins are, and
  the runtime e2e that tests what stays the runtime's around a moved window takes what desk-wm would
  publish from the shell fixture (`fixture/wm.ts`).

### Consequences

* Good, because no plugin surface is composited by a DOM in the app, and each window gesture and
  command runs once, in `desk-wm`, on the compositor's input.
* Good, because a split, the drawer and a desktop switch never reload a plugin on any desk now (ADR
  0040's bad consequence is gone, ADR 0151).
* Good, because the app e2e runs once per spec, on the desk people use.
* Bad, because there is no way back to the windowed desk short of a revert: a machine on which neither
  a GPU nor the software adapter gives the compositor a device opens no desk, and Windows and Linux are
  compiled against, not yet run (#61).
* Bad, because the runtime still holds the window manager's state and its non-gesture operations, and
  desk-wm a mirror of it: the store crosses as JSON on every change until those writes move.
* Bad, because the runtime's own fixture pages can no longer drag or resize a window: a runtime spec
  that needs a window moved publishes what desk-wm would.

## More Information

Issue #83 (child 6 of #53, epic #32 §5). Amends ADR 0149 (its mode and Stage 1's desk), ADR 0151 and
ADR 0153 (both modes and the windowed desk's own window manager), and ends ADR 0040's bad consequence.
Code: `apps/desk/shell/src/{window,compositor_window,client,crashes,drops,main}.rs`,
`apps/desk/shell/src/compositor_window/gpu.rs`, `apps/desk/src/desk.ts`,
`packages/runtime/src/shell/{wm-host,window-commands,windows,Pan,Desk}.ts`,
`packages/runtime/src/surface/{host-gestures,Surface,resize,snap}.ts`. Tests:
`packages/runtime/src/shell/window-commands.test.ts`, `packages/runtime/e2e/fixture/wm.ts`,
`e2e/specs/*.spec.ts`. No section of `docs/ko/desk-structure.md` changes.
