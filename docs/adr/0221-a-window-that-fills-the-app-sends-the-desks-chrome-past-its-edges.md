---
status: accepted
date: 2026-11-15
decision-makers: Team endue
---

Amends ADR 0132 (a filled window takes the whole app under the floating bars, which stay where they
are).

Amended by ADR 0253: the Drawer button moves into the strip under the canvas map and goes with it,
so the account bar alone stays.

# A window that fills the app sends the desk's chrome past its edges

## Context and Problem Statement

ADR 0132 gave a maximized window the whole app and kept every bar floating above it. It named the
cost: "the side bars, the rail, the bottom line and Eris lie over a filled window's edges: a
maximized Mail's mailbox list starts under the left bar". The option it turned down was "the whole
app with the bars hidden while a window fills it". The person now asks for that one: with a window
maximized, the left bar, the right bar and what is at the top right and the bottom right slide out
of the app, everything but the bottom left; and a part slides back in when the pointer comes to
where it went.

The desk's page hears the pointer only on its own parts (ADR 0160): over a window, the window's
page has it. A part that has left the app is no part, so the page cannot tell that the pointer
came to its edge.

## Decision Drivers

* A maximized window has the app to itself: nothing of the desk's lies over its content
* What went away is one movement of the pointer from coming back, with no key to remember
* The way back to everything else stays in sight: the account bar and the Drawer button
* No press is taken from the window: the edge is found by the pointer's place, not by a strip that
  hears it
* Nothing goes while it is in use: an open popover, the talk line, Eris at work, the keyboard's
  focus
* The compositor draws the page as it is laid out (ADR 0215); the slide is the page's, in CSS

## Considered Options

* The page slides its parts out; the compositor says which edges of the app the pointer is at
* The page slides its parts out and leaves thin unseen parts along the edges that hear the pointer
* The bars stay (ADR 0132 as it was)
* The bars hide for every fill, the halves and the quarters too

## Decision Outcome

Chosen option: "The page slides its parts out; the compositor says which edges the pointer is at",
because it takes no press from the window and keeps the motion where the parts are laid out.

* **When** (`packages/runtime/src/shell/away.ts`, `filled`): while a window on the desktop in
  front fills the whole app. A half or a quarter leaves the chrome where it is.
* **What goes, and where**: the agent bar to the left; the rail to the right, and the canvas map
  with it; the profile switcher and the desktops to the top; the running work to the bottom; Eris
  and the talk pill, which the person puts where they like, to the top or the bottom, whichever is
  nearer. The account bar and the Drawer button, bottom left, stay, and so do the status line and
  the notices.
* **The slide** (`shell/away.css`): each part moves by its `translate` past its edge, its whole box
  and 16 px more, over `--motion-base` with the desk's easing, and is hidden once it is out, so
  the page reports no part for it and nothing of it takes the pointer. Reduced motion zeroes the
  time: a part is there or not.
* **Coming back**: an edge's parts show while the pointer is within 10 px of that edge of the app,
  while the pointer is on one of them, while the keyboard's focus is on one, while a popover of
  theirs or the talk line is open, and while Eris is at work. They go 400 ms after none of these
  holds: the time to cross from the edge to the part.
* **The pointer's edges** (`apps/desk/shell/src/compositor_window/edges.rs`): the compositor tells
  the page the edges of the app the pointer is at each time they change, and none once it has left
  the app (`desk://compositor-edge`). The canvas map counts as the right edge while the pointer is
  on it. Where the page hears the pointer itself (its own parts; everywhere in a browser) it works
  the same band out.
* **The canvas map** (`compositor-desk.ts`, `draw_map.rs`): the page's report says how far the
  rail has slid and whether it is out, and the compositor draws the map that far toward the edge,
  or not at all.
* **The title bar** (`surface/clearance.ts`): with the switcher and the desktops away there is
  nothing to keep clear of, so a maximized window's title and tools take the bar's whole width.
  Brought back, the chips lie over the title for as long as they show.

### Consequences

* Good, because a maximized window's content is clear of every bar: 1440 × 900 with nothing over it
  but the account bar and the Drawer button
* Good, because no key and no mode: the pointer at an edge is the whole of it
* Bad, because the desk's controls are out of sight while a window is maximized; a person who does
  not try the edges finds them again by restoring the window
* Bad, because a pointer that goes to the app's edge for something else (a scrollbar at the right
  edge, the title bar's top) brings the bars in over it for as long as it stays within 10 px
* Bad, because the chips brought back at the top cover the window's title and tools while they show
* Neutral: Eris and the talk pill go too, and come back by themselves while Eris works or the talk
  line is open

### Confirmation

`packages/runtime/src/shell/away.test.ts` (what goes where, what holds a part, the leave time),
`packages/runtime/e2e/shell-away.spec.ts` (the same in a browser, the title clearance, reduced
motion), `apps/desk/src/compositor-desk.test.ts` (the map in the report),
`compositor_window/edges.rs` and `draw_spread_tests.rs` (the band, telling only changes, the map's
slide).

## Pros and Cons of the Options

### Thin unseen parts along the edges

* Good, because the compositor learns nothing new: a part hears the pointer already
* Bad, because a part takes the press too: the outermost pixels of the maximized window, where its
  scrollbar and its resize grips are, would be the desk's

### The bars stay

* Good, because nothing moves and every control is in sight
* Bad, because it is the cost ADR 0132 named, and the person asked for it to go

### The bars hide for every fill

* Good, because one rule for every fill
* Bad, because a half leaves the other half of the desk in use, where the bars are needed, and the
  person asked for the maximized window alone
