---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0164 (a paint put a surface back on every desk frame for a second) and ADR 0157 (the
slow clock's frames, which were counted by number and shared).

Status: amended by ADR XXXX: lone paints on a rhythm (a caret's blink) take two slow frames a blink
once three came the same time apart, and a frame of pictures alone no longer lays the scene out.

# A lone paint keeps a surface on slow frames, not on every frame

## Context and Problem Statement

The QA pass (#163, finding 15) found a desk that only shows a blinking caret costing 11 to 13 % of a
core in the debug build: the palette open with nothing typed, Settings with the caret in its search
field, 61 begin frames a second for 2 paints. ADR 0164 lets a surface rest once it painted nothing
and heard nothing for a second, and a paint put it back on every desk frame its pace takes for that
second. A caret blinks every half second, each blink one paint, so it never rested. CEF says nothing
of what a renderer waits for, and a caret's blink is not something the page's ask script can see
(no `requestAnimationFrame`, no change to the document): the next blink needs a begin frame the desk
sends without being asked. How does a blinking caret stop putting every frame on the clock, and
still blink?

## Decision Drivers

* Begin frames a second near the paints a second for a caret (#163's acceptance)
* A caret keeps blinking, evenly, whatever else wakes the desk
* An animation, a video or a GIF keeps every frame; `deskAtRest` and `inputFromRest` hold
* No patch to CEF or Chromium (ADR 0157)

## Considered Options

* Tell painting from a lone paint: two paints less than 250 ms apart keep every frame; a lone paint
  keeps the surface on slow frames, ten a second, on times of its own
* A shorter window of every frame after any paint (100 ms), then rest: the caret's next blink finds
  no begin frame and stays as it was until the person does something
* The page asks for its caret's blinks (`frame_asks.js` watching the focus and the selection): the
  page knows neither the blink's interval nor its phase, and a first ask comes 40 ms late
* Keep ADR 0157's shared slow frames, every sixth desk frame by number: measured, below; the
  numbers start again from any look half a frame late, so they drift against the page's timer
* No caret blink (the macOS default `NSTextInsertionPointBlinkPeriodOn`): a product change, not a
  frame clock's

## Decision Outcome

Chosen option: "Tell painting from a lone paint", because a caret then costs ten begin frames a
second where it cost sixty, and every other page keeps the frames it had.

* **Painting** (`frames.rs` `PAINTING`, `frames_pacing.rs`): two paints less than 250 ms apart, the
  later one less than 250 ms ago, keep a surface on every frame its pace takes, as input does: an
  animation, a 24 fps video, a GIF of four frames a second or more. A new page's first paint wakes
  it as input does.
* **Slow frames** (`SLOW`, ten a second, or its pace if that is slower): a lone paint with nothing
  heard keeps the surface on them, so a change its page cannot see paints within a tenth of a
  second. They keep their times from the first one on (each a whole number of periods after it),
  not the desk frames' numbers: `Clock::frame` starts its count again from a late look, and at rest
  looks come at CEF's times, so frames counted by number moved against the blink's timer. A 500 ms
  blink meets times 100 ms apart at the same moment each time.
* **Rest**: a surface rests once it painted nothing for a second and the desk sent it ten begin
  frames since its last paint, and heard nothing. The count is there for an event loop held for
  seconds (a long task in CEF's work): by the clock alone, its first look after the hold rested a
  surface whose blink no frame had reached, and the caret stood still until input.
* An ask (`frame_asks.js`) still brings the desk frames within 42 ms, on slow frames as at rest.

### What the measures found (macOS 26, M4 Max, debug build, the screen locked, load average 7 to 20)

* Main, three windows of 5 s: the palette open, nothing typed: 47 to 58 begin frames a second for
  2.0 paints, 225 to 339 event-loop turns a second, the main process at 8.2 to 17.3 %; Settings
  open: 58 begin frames for 2.0 paints, 266 turns, 12.7 %.
* This change: the palette open: 10.0 begin frames for 2.0 paints, 54 to 70 turns, 5.8 to 8.6 %
  (most of the rest is the window composing for captures on the locked screen, 373 of about 600
  busy samples in 6 s); Settings open: 10.0 for 2.0, 58 to 59 turns, 4.6 to 4.7 %; both closed,
  0.7 to 2.3 % and 22 to 24 turns, on main and with this change.
* The caret's rhythm, the palette's 30 paints in each of two runs of 15 s: on slow frames counted
  by number, 393 to 610 ms apart in both; on times of their own, 471 to 548 and 409 to 597, most
  485 to 510 in both.
* The desk's page under a stats poll every 10 or 40 ms from that page (its renderer and the shell
  both loaded): with the rest by the clock alone, the page rested with its caret unpainted in 3 of
  6 runs; with the count, in none of 11. Main's pacing, the same poll: none in 5.
* The pointer on Eris's figure: 33.5 begin frames a second for 33.5 paints, then rest.
* `deskAtRest` (the probe's rest run): 10.4 wake-ups a second, 0.5 % CPU, no begin frame, a page's
  own change painted in 51.1 ms. `inputFromRest`: p95 7.87 ms.

### Consequences

* Good, because a caret blinking in one field costs ten begin frames a second, and the desk's loop
  wakes about 55 times a second for it where it woke 225 to 339 times.
* Good, because the blink stays even, and a desk held for seconds does not leave it standing still.
* Bad, because a change the page cannot see waits up to 100 ms on the slow frames where it waited a
  frame: a CSS animation's first step after a delay, a GIF slower than four frames a second.
* Bad, because a blink interval that 100 ms does not divide (a person's own
  `NSTextInsertionPointBlinkPeriodOn`) meets the slow frames at moments that move, by up to 100 ms.
* Bad, because each surface on slow frames has times of its own, where ADR 0157's were shared: two
  surfaces on them wake the desk twice as often as one.

## More Information

Issue #163 (from the QA pass #154), finding 15. Amends ADR 0164 and ADR 0157. Code:
`apps/desk/shell/src/web_host/frames.rs`, `frames_pacing.rs` (`Pacing`, moved out of `frames.rs`).
Tests: `web_host/frames_slow_tests.rs`, `web_host/frames_pacing_tests.rs`, `web_host/frames_tests.rs`,
`tests/budgets.rs` through `just perf-compositor` (`deskAtRest`, `inputFromRest`). No section of
`docs/ko/desk-structure.md` changes.
