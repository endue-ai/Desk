---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0160 (every control the desk's page draws outside its windows is in a part, and a window
under an edge bar is under it whole).

# What the desk draws over the dock takes its own presses

## Context and Problem Statement

The compositor draws the desk's page above every window (ADR 0160): each part the page names whole,
heard by the page, and the rest of the page wherever no window lies over another's part, letting the
pointer through where an edge bar's surface (the dock) or a window lies under it. The QA pass of
2026-11-11 (#158 findings 1 and 9, #159 findings 4 and 6) found what that left: a press on the talk
pill or inside its open line went to the dock's tile under it (Mail turned off and its window closed)
and the keys to the dock, so what was typed reached nothing; "Restore previous layout" turned
Projects off; the Drawer button and Tile gave the keys to the window lying under them. The part
`desk.bottom` named the footer, which has no height of its own (its controls are placed one by one),
so it was never reported, and the arrange strip was in no part. And a window dropped with its title
bar under the dock had its icon and tools drawn over the dock's tiles while a press on its "×" closed
the Notes window through the tile under it: the page's pixels of a window were drawn above the bar,
the pointer went to the bar. What does the compositor draw over an edge bar, and who hears it there?

## Decision Drivers

* What is drawn is what is pressed: no press reaches a surface the person cannot see there
* The dock hears its own presses wherever nothing of the desk's is drawn over it
* No new protocol and no read-back of the page's pixels

## Considered Options

* Every control the page draws outside its windows is in a part, and a window under an edge bar is
  under it whole
* The same parts, and a window's title bar wins over the edge bar: its page parts drawn above the bar
  and heard by the page there
* The page hears every pixel of itself it draws over a bar that is not see-through (its alpha read
  back from the texture)

## Decision Outcome

Chosen option: "every control the page draws outside its windows is in a part, and a window under an
edge bar is under it whole", because it keeps one order for everything the compositor stacks (the
windows, then the edge bars, then the page's parts) and makes no window half above and half under a
bar.

* **Parts** (`desk_web::sender::PARTS`, `apps/desk/src/compositor-system.ts`): `desk.bottom` is a box
  for each control of the bottom edge (the Drawer button, the talk pill and its open line, the running
  chips: `footer.bottom > *`), and three parts are new: `desk.arrange` (the arrange strip),
  `desk.canvas` (the button that puts the canvas back) and `desk.safe` (the safe mode badge).
  The talk line's list and the drawer's list are overlays already (`desk.overlays`, ADR 0166).
* **Windows under an edge bar** (`compositor_window/system.rs`): the system layer draws the page's
  pieces over a window only where no edge bar lies over that window. What the page draws of a window
  (its icon, its tools, a view of its own such as Claude Code's screen) is drawn with the window, at
  its place in the stack, under the bar, which hears the press there.
* **Held by tests**: `compositor_window/system_tests.rs` (a window's tools under the dock show the
  dock and press it), `apps/desk/src/compositor-system.test.ts` (the bottom edge's controls, the strip,
  the canvas button and the badge are reported), and the app e2e `e2e/specs/system-parts.spec.ts`
  (every control the page shows outside its windows is heard by the desk alone; typing after a press
  on the pill and inside its line stays in the line; Restore and the Drawer button press no dock tile
  and give the keys to the desk).

### Consequences

* Good, because the pill, its line, the Drawer button and the arrange strip take their own presses and
  the keys, wherever the dock or a window lies under them, and a hovered or opened pill is drawn whole
  above the dock.
* Good, because a window under the dock is drawn as the dock covers it: its tools no longer show where
  the dock's tiles take the press, and the shell's own windows go under the dock as plugin windows do.
* Bad, because a window whose title bar lies under the dock cannot be seen or taken there at all until
  it is kept clear of the dock on a drop (#159 finding 4, the window manager's part).
* Bad, because a control the page adds outside its windows without a part lets its presses through
  again; the app e2e lists every control it finds, so a new one fails it.

## More Information

Issues #158 (findings 1, 9) and #159 (findings 4, 6). Amends ADR 0160. Code:
`crates/desk-web/src/sender/system.rs`, `apps/desk/src/compositor-system.ts`,
`apps/desk/shell/src/compositor_window/system.rs`. Tests: `apps/desk/src/compositor-system.test.ts`,
`apps/desk/shell/src/compositor_window/system_tests.rs`, `e2e/specs/system-parts.spec.ts`. No section
of `docs/ko/desk-structure.md` changes.
