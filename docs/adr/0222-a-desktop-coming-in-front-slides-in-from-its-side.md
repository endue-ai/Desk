---
status: accepted
date: 2026-11-15
decision-makers: Team endue
---

# A desktop coming in front slides in from its side

## Context and Problem Statement

A desk has several desktops, picked by their chips at the top right, by their keys and by a step
(ADR 0117). A switch swapped every window in one frame: the windows of one desktop were gone and
the other's were there. Nothing said that the desktops lie in a row, or which way the person had
gone; with two desktops that look alike, nothing said that anything had happened. The person
asked for the desktops to pass by sideways as one is picked.

The window manager places the windows of the desktop in front and no other (`desk-wm`), and the
compositor draws each frame from that plan alone. The windows of the desktop that left are in no
plan once the switch is made.

## Decision Drivers

* A switch shows which way the desktop picked lies: further along from the right, before from the
  left
* Both desktops are in the motion: the one that left goes as the one picked comes
* A window is drawn where a press finds it, during the slide too
* The surfaces' lifecycle stays as it is: no page is kept alive or loaded for the slide
* Reduced motion moves nothing
* No number of its own: the desk's `--motion-base` and easing, as its glides have

## Considered Options

* The window manager brings the desktop in front in from its side; the compositor draws the
  desktop that left from the windows it drew last, a whole app ahead
* The compositor moves both desktops as pictures and the window manager knows nothing
* A cross-fade
* The switch stays as it is

## Decision Outcome

Chosen option: "The window manager brings the desktop in front in; the compositor draws the one
that left from the windows it drew last", because the windows of the desktop in front are then
where the window manager says they are in every frame, and the desktop that left costs one kept
plan and no page.

* **The slide** (`crates/desk-wm/src/interact/slide.rs`): when another desktop is in front than at
  the last frame, the window manager starts a slide of a whole app's width: from the right when
  the desktop lies further along the desktops' order, from the left when it lies before, whatever
  the distance. It lasts `--motion-base` with the desk's easing. Every window of the desktop in
  front is drawn that far to the side of where it rests (`Wm::drawn_rect`, so `Frame::drawn` and a
  press mid-slide agree). The first desk drawn, a switch from a desktop that is gone and reduced
  motion slide nothing.
* **The desktop that left** (`apps/desk/shell/src/compositor_window/hosted_slide.rs`,
  `draw_slide.rs`): the plan in hand when the switch comes still holds its windows. They are kept
  as drawn and drawn as one sheet, the same width ahead of the desktop coming in
  (`Frame::slide`'s second number), under its windows, from the textures their pages last
  painted. The sheet takes no pointer, and none of its surfaces is placed: their pages are hidden
  as a switch always hid them. A window both desktops show is on both sheets.
* **A switch during a slide** starts the next from its own side; the desktop that left is then the
  one that was coming in, where it was drawn.
* `desk.windows.list` and the page's own layout are untouched: they say where a window rests.

### Consequences

* Good, because the row of desktops is something the person sees, and a switch between two desks
  that look alike is seen to happen
* Good, because nothing new lives through the slide: no page, no texture, no timer of the shell's
* Bad, because the desktop that left is drawn from its last pictures: a video in one of its
  windows stands still for the slide's 220 ms
* Bad, because a window of the desktop that left whose own page had not painted yet shows without
  what the desk's page drew of it (its title bar's tools), for the slide alone
* Neutral: the system layer does not move; the chips, the bars and Eris stay where they are

### Confirmation

`crates/desk-wm/tests/interactions/slide.rs` (the side, the frames of a slide, a switch during
one, no motion), `compositor_window/hosted_slide.rs` (the desktop that left kept as drawn, moved,
let go). The picture itself is checked on the headless desk
(`DESK_COMPOSITOR_HEADLESS=1`, a capture each 30 ms of a switch); `just perf-motion` stays green.

## Pros and Cons of the Options

### The compositor moves both desktops as pictures

* Good, because the window manager stays as it is
* Bad, because a window is then drawn where the window manager does not have it: a press during
  the slide lands beside the window under the pointer

### A cross-fade

* Good, because it needs no side and no kept plan's geometry
* Bad, because it says nothing of where the desktop lies, which is what was asked for

### The switch stays as it is

* Good, because the fastest
* Bad, because it is the report: the desktops do not pass by
