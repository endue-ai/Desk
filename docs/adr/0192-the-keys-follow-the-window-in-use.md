---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0150 (the runtime's focus moves come from the page; Ctrl+Tab keeps the keys on the
window's section) and ADR 0160 (a surface's place holds its spot in the page's focus order).

# The keys follow the window in use

## Context and Problem Statement

The QA pass of 2026-11-11 found the window marked in use without the keys again and again: after
Ctrl+Tab, `desk.display.focus-next`, `desk.windows.focus` and `desk.display.show`, after a title
drag, after a file opened (Images walked its folder once per click), after a permission question
came up (Escape, Enter and Tab did nothing until it was clicked), and after the palette closed
(#158 finding 10, #159 finding 2, #160 finding 11, #162 findings 6 and 7). What was typed went to
the desk's page, which opened the talk line with it. A press on the divider between two panes gave
the keys to the window underneath (#159 finding 5; the desk's buttons over a window, finding 6, are
parts of the system layer since ADR 0167 and take their own presses).

The compositor's keyboard focus moved only by a press on a surface, or by the page's report of
which surface's place had its focus (ADR 0150). The window manager's "in use" moved by another
path. The runtime gave a surface the focus by focusing its window's section, which ADR 0150 kept as
the page's for Ctrl+Tab; a press on a title bar gave the keys to the page; and the palette closing
left the page's focus on its body, which kept them there. Who decides where the keys are when the
person did not press on a surface?

## Decision Drivers

* The window shown in use has the keys, without a click, however it came to be in use
* A field or a button of the desk's own (the talk line, a launcher, the rail) keeps the keys it
  has, and an overlay (the palette, the first run) keeps them while it shows
* A press goes to one owner: a window covers what lies under it
* Tab into and out of a surface's page goes on as ADR 0150 (#123) set it

## Considered Options

* The keys follow the window in use where the page's focus rests on nothing of its own: the router
  hears the surface in use from the window manager and where the page's focus rests (a place, an
  element of its own, nothing)
* The runtime alone moves the page's focus to the place of the surface in use after every move
* The window manager alone decides, and the page's focus never moves the keys

## Decision Outcome

Chosen option: "the keys follow the window in use where the page's focus rests on nothing of its
own", because the window manager is the one that knows which window is in use, also after moves the
page does not make (the spread, a window closed), and only the page knows whether one of its own
elements has the focus.

* **Where the page's focus rests** (`apps/desk/src/compositor-focus.ts`): the page says which
  surface's place has its focus, or whether an element of its own does (`own`): its body and a
  window's or a surface's section are nothing of its own.
* **The router** (`crates/desk-compositor/src/input/follow.rs`): a place gives its surface the
  keys; an element of the page's own gives them to the page; resting on nothing they go to the
  surface in use, the one the pane in use of the window in use shows (to the page for a pane the
  page draws). A press on the page (a title bar, a divider, a grip, the desk itself) leaves them
  there, unless an element of the page's own has them. When the window in use changes, the keys go
  along, unless an element of the page's own or a surface shown outside every window holds them.
* **The runtime** (`packages/runtime/src/pages/remote.ts`): giving a surface the focus puts the
  page's focus on its place, not on its section alone, so a Tab past the surface page's end goes on
  from there. Ctrl+Tab gives the window the keys; Tab from the page's own order still enters a
  place at its edges (ADR 0150, #123).
* **A window covers what lies under it** (`Targets::set_areas`): a point inside a window that none
  of its surfaces shows (the divider between its panes, its frame, a corner) is the page's, never a
  surface of a window below.

### Consequences

* Good, because what is typed reaches the window shown in use after every way of reaching it, and
  the talk line opens only when the person asks for it or no plugin window is in use.
* Good, because the compositor follows window manager moves the page never sees.
* Bad, because a press on the empty desk no longer hands the keys to the page while a plugin
  window stays in use: typing there goes to that window, not to the talk line. The talk pill and
  ⌥Space still open the line.
* Bad, because the page's report carries one more field, which the page and the shell must agree on.

## More Information

Issues #158 (finding 10), #159 (findings 2, 5, 6), #160 (finding 11), #162 (findings 6, 7); work
order B1 of the QA pass #154. Code: `crates/desk-compositor/src/input/{follow,router,targets}.rs`,
`apps/desk/shell/src/compositor_window/{input,commands}.rs`, `apps/desk/src/compositor-focus.ts`,
`packages/runtime/src/pages/remote.ts`. Tests: `crates/desk-compositor/tests/input_follow.rs`,
`apps/desk/src/compositor-focus.test.ts`, `packages/runtime/src/pages/remote.test.ts`, app e2e
`e2e/specs/keys-follow.spec.ts` and `a11y.spec.ts`. `docs/architecture.md` does not describe the
focus, so it does not change.
