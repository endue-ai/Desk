---
status: accepted
date: 2026-11-15
decision-makers: Team endue
---

Amends ADR 0192 (the keys follow the window in use: the page's focus on a window's surface no longer
moves them, and a press no longer waits for the page to name the window), ADR 0199 (what is typed
waits for the page's answer: only after a press that is no window's and after a key the desk runs)
and ADR 0150 (the runtime's focus moves come from the page). Carries ADR 0205's quality track, step 5.

# desk-wm decides the window in use, and the router and the page follow

## Context and Problem Statement

About ten places held a part of the focus: the router's key target, its copies of the page's focus
and of the window in use, the OS window's focus, `desk-wm`'s window in use, the runtime's store, the
page's DOM, each browser's own focus, the accessibility tree, and the overlays (the palette, a
question). Three hops joined them, none in step with the others. A press on a window's surface gave
that surface the keys in the compositor at once, while the window came into use only after the page
heard the same press, asked the window manager for it and the desk came back. A press on a title bar
held what was typed for up to 500 ms until the page had said where the keys were (ADR 0199). The
page's focus on a surface's place moved the keys without the window manager hearing of it (a Tab
into a plugin, a desk that arrived late), so on 2026-11-13 the inspector named the keys at one plugin
while another window was in use. `desk-wm` already kept the window and pane in use (ADR 0158); it
only never decided them. Who says which window is in use and where the keys go, so that a press, a
key, a command and an agent's call all end in the same state without waiting for the page?

## Decision Drivers

* One place decides, at the moment the press, the key or the call is applied; nothing waits for the
  page to agree
* The window drawn in use, the surface with the keys and the page's focus name the same window after
  every step
* A request that arrives late (the page's, for a window the person has left since) cannot take the
  window in use back
* What only the page knows stays the page's to say: a field of its own, an overlay it shows
* No new timer, and the 500 ms hold kept only where a test shows the page must answer first

## Considered Options

* `desk-wm` decides the window and pane in use; the router reads it in the same turn; the page is told
  by the desk it publishes and says only what its own fields hold
* The router decides on a press (as it did for a surface) and tells `desk-wm`: the window manager's
  stack, the spread and the commands would still decide elsewhere
* The page stays the one that asks on a press, and reports sooner: the hop that made the races stays
* `desk-wm` also owns the overlays and the page's fields: it cannot know the DOM

## Decision Outcome

Chosen option: "`desk-wm` decides, the router reads, the page is told", because the window manager
already holds the window in use, hears every press first (ADR 0153) and applies every command.

* **A press** (`crates/desk-wm/src/interact/focus.rs`): the window drawn topmost under a press comes
  into use, with the pane under the point, before the press is routed, for any button. A part of the
  system layer over the window (ADR 0198) and the empty desk change nothing. The desk is published so.
* **The router** (`input/follow.rs`, `compositor_window/focus.rs`): the shell tells it the window
  manager's surface in use in the same turn as every change (a press, an edit, a window command), not
  on the next tick. A window or pane that changed is a decision (`decided`): the keys go there at
  once, also from a field of the page's own. A press on a window's surface reads that decision
  instead of taking the keys for the surface pressed.
* **The page says only what it holds** (`apps/desk/src/compositor-focus.ts`): an element of its own
  with the focus, or the place of a surface it shows outside every window (an overlay, an edge bar).
  Its focus on a window's surface says nothing, and the router ignores it if said. The page asks for
  no window on a press (`WindowManagerHost.decidesPress`); a Tab into a plugin's place asks the window
  manager, as a command does.
* **The page is told** (`packages/runtime/src/shell/windows.ts`, `focus-surface.ts`): each published
  desk that puts another window or pane in use moves the page's focus there, asking for nothing
  (`followSurface`), so a desk that arrives late cannot ask the window manager back. While a move
  the runtime itself asked for is on its way, that move's own desk is the one followed, as before
  (issue 160). An overlay with the page's focus keeps it, and keeps the keys: the window in use
  changes under it.
* **A key, a command, an agent's call** end in an edit `desk-wm` applies. `desk.display.focus-next`,
  `focus-previous` and `show` answer once it did, so whoever ran them reads the desk they made.
* **The key hold stays for two cases** (`input/hold.rs`), where only the page knows the answer: a
  press on the page that is no window's (the talk pill opens its line) and a key the desk runs (⌘K
  opens the palette). ADR 0199 measured the page's answer 50 to 140 ms after the press. Measured
  again on 2026-11-15 with this change and the hold switched off in a development build, two runs of
  two attempts each: `e2e/specs/system-parts.spec.ts` (keys typed in the same burst as the press on
  the pill) failed all four times with "what was typed never reached the talk line", and
  `keys-follow.spec.ts` (a word typed 10 ms apart after ⌘K) failed all four. With the hold both
  pass. A press in a window, its title bar and dividers too, holds nothing any more. The 500 ms
  limit is ADR 0199's; this page adds no threshold.
* **Windows out of the canvas and the island** follow the same owner. An OS window that takes the
  OS's focus tells `desk-wm` (`Op::Focus`), which names it in use, and a window `desk-wm` puts in use
  while it is out is raised by the shell (`handed.rs`). The island is no window of the desk: while it
  has the OS's keys the window in use stays as it is.

### Consequences

* Good, because a press puts its window in use, in front and with the keys in one step, and what is
  typed right after a press on a title bar reaches the window with no wait
* Good, because the window in use, the keys and the page's focus agree after every step, checked
  with no timer (`e2e/specs/focus-owner.spec.ts`)
* Good, because the page can no longer move the keys to a window the window manager does not have
  in use, nor ask for a window by following
* Bad, because the page's focus still arrives one hop after the decision: for that hop a field of
  the page's own that had it still shows its caret, without the keys
* Bad, because a claim of the page's in flight when the window manager decides (a field focused in
  the same instant) is honoured until the page follows the desk and says otherwise
* Bad, because overlays stay outside `desk-wm`: which overlay has the keys is still the page's word
* Neutral, because Ctrl+Tab's order is still the runtime's list of what is in sight; only the move is
  the window manager's

## More Information

Issue #251, part of #232. Code: `crates/desk-wm/src/interact/{focus,pointer}.rs`,
`crates/desk-compositor/src/input/{follow,hold,router}.rs`,
`apps/desk/shell/src/compositor_window/{focus,wm,input}.rs`, `apps/desk/src/{compositor-focus,
compositor-wm,desk}.ts`, `packages/runtime/src/{focus-surface,runtime}.ts`,
`packages/runtime/src/shell/{windows,Desk}.ts`, `surface/Surface.ts`, `pages/{place,remote}.ts`,
`policies/display.ts`. Tests: `crates/desk-wm/tests/press_focus.rs`,
`crates/desk-compositor/tests/input_owner.rs`, `packages/runtime/src/focus-surface.test.ts`,
`shell/windows.test.ts`, `shell/Desk.test.ts`, `pages/remote.test.ts`,
`apps/desk/src/compositor-focus.test.ts`, app e2e `e2e/specs/focus-owner.spec.ts`.
`docs/architecture.md` and `docs/ko/desk-structure.md` do not describe the focus, so they do not
change.
