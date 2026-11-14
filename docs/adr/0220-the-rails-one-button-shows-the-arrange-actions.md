---
status: accepted
date: 2026-11-14
decision-makers: Team endue
---

Amends ADR 0116 (a strip of four arrange buttons at the right edge) and ADR 0167 (the strip is the
`desk.arrange` part of the system layer).

# The rail's one button shows the arrange actions

## Context and Problem Statement

ADR 0116 put Tile, Cascade, Spread and Restore in a strip of their own in the bottom right, under
the right rail, and named its cost: "the strip sits beside the rail, not in it". The canvas map then
took the corner beside it (ADR 0082), so the bottom right held two unrelated things, and the person
asked for the arrange actions to leave it: one button in the right bar, whose actions show when the
pointer is on it.

## Decision Drivers

* The bottom right holds the canvas map and nothing else of the desk's
* One place for what the desk says and does about itself: the right rail
* An arrange action is two movements away at most, with no press needed to see them
* The keyboard and a touch reach the same actions without a pointer to hover with
* The commands, their keys and the undo stay as they are (ADR 0116)

## Considered Options

* One button in the rail; its actions show under the pointer, and a press keeps them open
* One button in the rail; its actions show on a press only, as the rail's other popovers do
* The four buttons in the rail
* The strip stays, folded to one button in the corner

## Decision Outcome

Chosen option: "One button in the rail; its actions show under the pointer, and a press keeps them
open", because it is what the person asked for and it leaves no button of the strip's behind.

* **The button** (`packages/runtime/src/shell/Rail.ts`): the rail's last, `data-rail="arrange"`,
  with the Tile icon and the label "Arrange windows". Its popover (`arrange/menu.ts` says what is
  in it) lists Tile, Cascade and Spread, then Restore under a divider, each with its icon, its
  words and its key as the keymap has it now. An action that cannot run (nothing to arrange, nothing
  to restore) is `aria-disabled` and does nothing.
* **Under the pointer**: the popover opens when the pointer comes onto the button, unless another
  popover is open, and closes 350 ms after the pointer has left both the button and the popover:
  the time to cross the 12 px between them, where the pointer is over the canvas. A choice closes it.
* **A press** on the button while its actions show keeps them open until the next press, Escape or
  a press elsewhere, as every other popover of the rail; Enter or Space on the focused button does
  the same, so the keyboard and a touch need no hover.
* **Where it opens**: beside the rail, its bottom level with the button's bottom, so the list grows
  up from the rail's last button and stays inside the app at every size the desk supports.
* **The part goes** (`desk_web::sender::PARTS`, `apps/desk/src/compositor-system.ts`): no
  `desk.arrange`. The button is in `desk.rail` and its popover in `desk.overlays`, as the rail's
  other popovers are.
* **The canvas map** (`compositor_window/draw_map.rs`) moves into the corner the strip left: 24 px
  from the right edge, under the rail. In an app shorter than 734 px, where the rail would reach
  the map, the map goes left of the rail's column (92 px from the edge), where it was.

### Consequences

* Good, because the bottom right is the map's alone and the rail is the one place for the desk's
  own controls
* Good, because the actions cost no press to see, and show their keys, which the strip showed only
  in a tooltip
* Bad, because an arrange action is now a hover and a press, where the strip took one press; the
  keys (ADR 0116) and the palette are unchanged
* Bad, because a pointer crossing the rail's last button opens a list nobody asked for; it closes
  350 ms after the pointer has gone, and never opens over another popover

### Confirmation

`packages/runtime/e2e/arrange.spec.ts` holds the hover, the leave, the press that keeps the actions
open, the keyboard and the place at four app sizes; `e2e/specs/system-parts.spec.ts` and
`keys-follow.spec.ts` hold that a press on an action is the desk's alone;
`compositor_window/draw_spread_tests.rs` holds the map's place.

## Pros and Cons of the Options

### One button; actions on a press only

* Good, because it is the rail's one behaviour for every button
* Bad, because it is not what was asked for: every arrangement costs two presses

### The four buttons in the rail

* Good, because each action stays one press away
* Bad, because the rail grows to ten buttons and no longer fits a 640 px app, and the person asked
  for one

### The strip stays, folded to one button

* Good, because the smallest change
* Bad, because the corner still holds a control beside the map, which is what the person wanted gone
