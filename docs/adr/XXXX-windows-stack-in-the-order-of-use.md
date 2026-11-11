---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0082 (floating windows stack above every normal window, focused or pinned), ADR 0116 (a
cascade in desk order) and ADR 0128 (a snapped window floats above every normal window).

# Windows stack in the order of use, and the window in use is on top of every other

## Context and Problem Statement

A window's stacking level was its index in desk order, with the focused one lifted (`zOf`, then
`desk_wm::cover::z_of`), and every floating window above every normal one (ADR 0082). Desk order is
the layout's windows, then the plugin windows in their slots, so it is not the order the person used
the windows in: focusing did not move a window in it, and a window that left its slot (moved,
filled, new) went to the start of it, under every slot window. The QA pass of 2026-11-11 (issues
#159 and #163) saw the window used a moment ago sink back into the pile, to the very bottom if it
had ever been moved, filled or was new; ten new windows ended with each under every older one. And
since a fill floats (ADR 0128), a maximized or snapped window stayed above the window in use: a new
window, or one reached with Ctrl+Tab, was in use but out of sight, and what the person typed went
to it unseen. How should the windows stack?

## Decision Drivers

* The window in use is in sight: it takes the keys
* The window used before it is right behind it, whatever happened to it, as on every desktop OS
* A window floating by choice (a reference, a player) still stays above the canvas it floats over
* One rule for what the compositor draws, what the page stacks, `desk.windows.list` and the cover
  that puts hidden plugins to sleep (ADR 0070)

## Considered Options

* The order of use: the window in use on top; floating-by-choice windows above the rest; fills
  among the normal windows; each kind in the order of use
* Keep desk order and only lift the window in use above the floating ones
* Move a window to the end of desk order when it takes the focus

## Decision Outcome

Chosen option: "the order of use", because it is the pile the person builds by using the windows,
and it keeps ADR 0082's overlays without letting them, or a fill, hide the window in use.

* **The order of use** (`desk_wm::cover::UseOrder`, the desk's `used`): the windows in the order they
  were last put in use, the least recent first, at most 64. A window comes on top of it when it takes
  the focus (a press, a command, Ctrl+Tab, a new window, a move to the desktop in front) and when it
  is filled or comes back from a fill, which brings a window an agent maximized in front without
  taking the keys from the window in use. Windows never in use since the desk started stack under
  the others as they did before, the floating and filled ones above those on the canvas, each in
  desk order, so a profile's first layout and a restored session stack as they did.
* **Levels** (`z_of`, `UseOrder::levels`): the window in use above every other, a filled or floating
  one too; then the windows floating by choice (floating, no fill); then the normal and filled ones.
  Within each, pinned windows above the unpinned, then the order of use. The numbers stay in the
  bands the page used before (1 and up, pinned 50 and up, floating 200 and up, the window in use
  300), so nothing else in the page's stacking moves.
* **A fill stacks with the normal windows**: it floats only to keep its part of the app under a pan
  and a resize (ADR 0128); a normal window used after it comes in front of it.
* **A cascade** lays the normal windows out back to front as they stack, the window in use last, so
  the stacking does not change and undoing the cascade gives back the desk as it was.
* Every reader takes the same levels: the host's plan (the compositor's drawing and hit order), the
  view the runtime stacks the page's windows by, `desk.windows.list`'s ranks, a press on a window
  mid-glide and the cover.

### Consequences

* Good, because the windows keep the order of use: the one used a moment ago is right behind, a new
  window opens in front and stays in the pile in the order it opened.
* Good, because the window in use is never hidden, by a fill or by a floating window.
* Good, because a snapped or maximized window no longer stays above every normal window (ADR 0128's
  bad consequence goes).
* Bad, because a floating window is now under the window in use where they overlap; it comes back
  above it when another window takes the focus.
* Neutral: the desk's JSON gains `used`, absent while empty; a desk without it stacks every window
  as never used. The runtime reads the levels from the view, not the list, and keeps no copy.
* Neutral: `desk-windows-list-scene.json` (specs/bridge/v0) lists its scene in the new order; its
  shape is unchanged.

## More Information

Issues #159 (findings 1 and 3) and #163 (finding 7). `crates/desk-wm/src/cover.rs`;
`crates/desk-wm/tests/stacking.rs`, `tests/cover.rs`. The keyboard following the window in use
(issue #159 finding 2) is the compositor's input focus, a separate change.
