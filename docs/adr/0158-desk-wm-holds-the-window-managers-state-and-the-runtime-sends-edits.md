---
status: accepted
date: 2026-11-11
decision-makers: Team endue
---

Status: amended by ADR 0160: the page keeps no stand-in frame inside its windows and moves none on a
split, the relay's re-greeting is gone, and `compositor.css` keeps only the windows' unpainted parts.
Amended by ADR 0161: the compositor draws the spread (#54), whose command, key and strip button
are back.

# desk-wm holds the window manager's state, and the runtime sends it edits

## Context and Problem Statement

After ADR 0156 `desk-wm` ran every window gesture and command, but the runtime still held the window
manager's state (the shell store's windows, panes, desktops, drawer, pan, tile and cascade) and its
own TypeScript operations over it, and published it whole for `desk-wm` to mirror. Every operation
existed twice, and the runtime's tests and fixture pages, which have no compositor, ran only the
TypeScript one. #83 ends this: who holds the state, how does a runtime caller change it and read the
result, and what runs the window manager on a desk without the compositor?

## Decision Drivers

* One window manager, `desk-wm`, for the state as for the gestures; the runtime keeps policies,
  commands, the plugin host, settings, profiles and the session record
* The runtime's callers never work a window out themselves, and never read a change before it is in
* Session and profile records keep their JSON
* The runtime's tests and fixture pages run the window manager the app runs

## Considered Options

* `desk-wm` holds the state and takes the runtime's edits; a desk without the compositor runs
  `desk-wm` as WebAssembly
* The same, with a TypeScript stand-in of the edits for desks without the compositor
* The runtime keeps the state (ADR 0156), `desk-wm` mirrors it

## Decision Outcome

Chosen option: "`desk-wm` holds the state and takes the runtime's edits, as WebAssembly where there is
no compositor", because it deletes the second window manager instead of moving it into a test file.

* **Edits.** Every change the runtime makes is an `Edit` (`desk_wm::edits`): opening, focusing,
  splitting and closing windows and panes, the drawer, desktops and their undo, the pan, tile, cascade
  and restore, the profile in force (`saved`, `switch-profile`, laid out by the runtime from its
  profiles), the session layer of `desk.shell.layouts` (`moved`, `revert`) and the session record
  (`restore`). The window manager applies a numbered batch in order and publishes the desk whole once
  (`Published`: the `Desk`, the `View` the runtime reads, each edit's answer: a new window's id, the
  plugins a close leaves to unmount, whether a move or an undo did anything, what an arrangement
  replaced).
* **The runtime's mirror.** The store keeps the last desk published (`wm/view.ts`'s `takeDesk`) and
  nothing else writes its window fields. Reads come from the `View` (every desktop's windows, layouts
  and on-screen rects, the windows of the desktop in front with their stacking levels, the plugin in
  use, what `desk.shell.layouts` keeps, the window ids). Actions are edits returning their answers
  once the desk they made is in; an action that needs a result awaits it, and one that would read
  after writing asks for one compound edit instead (`focus` then `close-pane` is `close-pane` naming
  the pane). `desk.windows.list` is `desk-wm`'s snapshot with the titles and frame states the runtime
  tells it (`compositor_snapshot`), plus the closed windows and capabilities.
* **The seam in the app.** The page sends `compositor_edit { seq, edits }`; the shell applies batches
  in their order (a call may overtake another), grabs and window commands name the last edit they
  follow (`after`), and a batch numbered 1 is a runtime that started again: its desk starts afresh.
  The page's report keeps only what the page knows (frames, titles, the chips, the budget's settings,
  the desk it took and the held window); its `desk` is gone, and `desk://compositor-wm` carries the
  whole desk.
* **Live budget.** `desk-wm`'s `LiveBudget` decides in the app (ADR 0151); the runtime's frame policy
  only carries out the set the host gives (`WindowManagerHost.live`). The stated rule for a desk
  without the compositor: no budget decides, every window keeps its frame (a test names a set with
  `keep`). `frames/live-budget.ts` and the policy's own budget and unload-after decisions go.
* **Without the compositor.** `crates/desk-wm-wasm` builds `desk-wm` for `wasm32-unknown-unknown`
  with one JSON call; `wm/local.ts` runs it synchronously. Vitest's global setup and the fixture
  server build it when it is stale (`scripts/desk-wm-wasm.mjs`); the fixture pages and the dev page
  load it from `/desk-wm.wasm`, and `fixture/wm.ts` moves windows through it.
* **Deleted from the runtime:** the store's drawer rule (`shell/away.ts`), the slots (`surface/tiling`),
  the cover test (`surface/cover`), fills and snaps (`surface/snap`), the pane tree's operations, the
  geometry the state used (`surface/geometry`, `coordinates`: what is left is the reference frame and
  the app's size), the desktops' list operations and moves (`desktops/{ops,move}`, `model.ts`'s
  writers), `arrange/{arranger,geometry,spread,spread-model,spread-view}`, `shell/{wm-host,wm-desk}`,
  `frames/live-budget`, and the page's `keptWindows`. The spread is not drawn on the compositor yet
  (#54): its model is `desk-wm`'s `spread/`, and its command, key and strip button wait for it.

### Consequences

* Good, because the window manager exists once, in Rust, and the runtime's tests, fixture pages and
  e2e run it: a fixture spec that tiles, cascades or restores a session checks `desk-wm`'s numbers.
* Good, because the runtime keeps no state it could disagree on with what the compositor draws.
* Bad, because every change is asynchronous in the app: a caller reading the store right after an
  action reads the desk before it (the local window manager publishes at once, so only the app e2e
  catches such a read).
* Bad, because the runtime's tests need a `wasm32-unknown-unknown` build of `desk-wm` (seconds when
  stale, the toolchain's target listed in `rust-toolchain.toml`).
* Bad, because a desk without the compositor keeps every frame live: the budget's decisions are
  tested in `desk-wm` and the app e2e, its carrying out in the runtime with a named set.
* Bad, because the page still lays out its windows' parts, keeps the stand-in frames inside them,
  moves them on a split (the relay's re-greeting stays), and draws the fixture's windows
  (`compositor.css` stays) until system surfaces (#55).

## More Information

Issue #83 (child 6 of #53, epic #32 §5), its second half. Amends ADR 0151 (the report's desk, the
mirror), ADR 0153 (what is published), ADR 0156 (what the runtime still kept) and ADR 0134 (the
runtime's own budget). Code: `crates/desk-wm/src/{edits,undo,view}.rs`,
`crates/desk-wm/src/desk/session.rs`, `crates/desk-wm/src/interact/{edit,publish,wm}.rs`,
`crates/desk-wm-wasm`, `apps/desk/shell/src/compositor_window/{wm,commands,hosted,report}.rs`,
`apps/desk/src/{compositor-wm,compositor-desk,desk}.ts`, `packages/runtime/src/wm/**`,
`packages/runtime/src/shell/{actions,windows,link,Desk,desk-view}.ts`,
`packages/runtime/src/desktops/actions.ts`, `packages/runtime/src/arrange/{commands,strip}.ts`,
`packages/runtime/src/frames/{policy,install}.ts`, `packages/runtime/e2e/fixture/{wm,wm-host}.ts`.
Tests: `crates/desk-wm/tests/edits.rs`, `crates/desk-wm/tests/interactions/wm.rs`,
`crates/desk-wm-wasm` (unit), `scripts/desk-wm-wasm.test.mjs`, the runtime's unit and e2e tests on
the WebAssembly window manager, `e2e/specs/windows-*.spec.ts`. No section of
`docs/ko/desk-structure.md` changes.
