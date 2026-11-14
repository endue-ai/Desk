---
status: accepted
date: 2026-11-14
decision-makers: Team endue
---

Amends ADR 0168 (the window in use on top of every other, a floating one too). Numbered past the ADRs
of open pull requests (0215 to 0217).

# A floating window stays above the window in use on the canvas

## Context and Problem Statement

ADR 0168 stacks the windows in the order of use and puts the window in use above every other,
"a filled or floating one too". A press puts a window in use, so every window dragged, and every
window opened, came in front of a window the person had set floating: a reference or a player put
above the canvas was covered the moment another window moved across it, and stayed covered. The
person reported it as a fault (a window moved fast covers the floating window), seen most with the
agents' windows, which open large and in use.

ADR 0168 lifted the window in use above everything for one case: a maximized or snapped window
floats (ADR 0128), so it stayed above a new window or one reached with Ctrl+Tab, which took the keys
unseen. The same ADR already ended that case on its own: a fill stacks with the normal windows.

The bridge's contract says what the person expects (`specs/bridge/v0/brain.schema.json`, `z`):
"floating windows above the normal ones; within each, the window in use on top and pinned ones above
the rest". The example scene beside it (`desk-windows-list-scene.json`) held the other order.

## Decision Drivers

* A window the person set floating is not covered by a window on the canvas, moved, opened or in use
* The window in use is still in front of every window of its own kind
* A fill never hides the window in use (ADR 0168 keeps this)
* One rule for the compositor, the page's stacking, `desk.windows.list` and the cover (ADR 0070)

## Considered Options

* Two kinds, each with its window in use on top: the floating windows above the windows on the canvas
* ADR 0168 as it is: the window in use above every other
* Only a window being dragged stays under the floating ones, and comes above them once dropped: the
  floating window is covered again at the drop

## Decision Outcome

Chosen option: "Two kinds, each with its window in use on top", because floating is the person's
word for staying above the canvas, and the case ADR 0168 lifted the window in use for is a fill's,
which stacks with the canvas's windows already.

* **Levels** (`desk_wm::cover::z_of`): a window in use that floats by choice keeps 300, above every
  other. A window in use on the canvas (normal or filled) is at 199: above every other window there,
  pinned ones too (50 and up), and under the floating ones (200 and up). The other bands are ADR
  0168's.
* **The contract's example** (`specs/bridge/v0/vectors/valid/desk-windows-list-scene.json`): the
  floating window is in front of the split window in use, as the schema's words say.

### Consequences

* Good, because a floating window stays in sight whatever moves or opens under it
* Good, because the contract's words and its example agree
* Bad, because a window in use on the canvas can lie partly, or wholly, under a floating window: it
  has the keys there. A floating window is the person's own choice and usually small; the spread and
  the focus cycle still reach the window under it
* Neutral, because a filled window in use lies under a floating one too: a player over a maximized
  window stays in sight

## More Information

`crates/desk-wm/tests/cover.rs` (`puts_the_window_in_use_above_the_others_of_the_canvas_and_under_a_floating_one`),
`crates/desk-wm/tests/stacking.rs` (`on_the_canvas_stays_under_a_window_floating_by_choice_and_above_the_rest`),
`crates/desk-wm/tests/scene.rs`. ADR 0082 (floating windows), ADR 0128 (a fill floats), ADR 0168
(the order of use).
