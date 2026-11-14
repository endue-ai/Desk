---
status: accepted
date: 2026-11-14
decision-makers: Team endue
---

Numbered past the ADRs of open pull requests (0215 to 0217).

# A wheel's run pans the canvas in the shell, and the canvas ends

## Context and Problem Statement

A wheel over the empty background pans the canvas (ADR 0082). Only the desk's page can tell the
background from a control, so every wheel went the round of the page: to its renderer, its listener,
an edit worked out from the page's copy of the pan (`{op: "pan", to}`), and back to the window
manager. Three faults came of it.

* A wheel that came before the last one's publish was worked out from the same pan and overwrote it.
  A fast pan moved in uneven steps and fell short of the wheel, the more so the busier the page.
* The compositor hands a wheel to what is under the pointer now (ADR 0150). As the canvas moved, a
  window came under the pointer, the next wheel of the same turn went to that window, and the pan
  stopped under a wheel still turning.
* The pan had no bound. A held wheel or a long drag took the windows where only the reset brings them
  back, and a pan past what a 32-bit float holds exactly would place windows off the device pixels the
  compositor draws on (ADR 0209).

## Decision Drivers

* No wheel's step is lost, however late the page publishes
* A pan under way goes on, whatever comes under the pointer
* The page still decides where a pan begins: the background is its DOM's to tell
* A window under the pointer is scrolled again as soon as the person means it
* One place bounds the pan, for every way it is written

## Considered Options

* The page sends each wheel's own step, and from the first one the shell pans the wheels that follow
  itself, for as long as the run lasts
* The shell decides alone where a pan begins, from the scene: it cannot tell the page's own controls
  on the background apart from it
* The page keeps every wheel and latches in its listener: a wheel over a plugin never reaches the
  page, so the run would still stop there, and each step still waits for the page
* A run that lasts while the wheel's phase says so (`TouchPhase`): a mouse's wheel has no phase, and
  winit cannot tell a trackpad's momentum from a new gesture

## Decision Outcome

Chosen option: "The page sends each wheel's own step, and from the first one the shell pans the
wheels that follow itself", because it keeps the one decision the page must make and takes every
other wheel off the page's round.

* **The step** (`crates/desk-wm/src/edits.rs`): `{op: "pan-by", by}` moves the canvas of the desktop
  in front from where the window manager has it. The runtime's wheel sends it
  (`packages/runtime/src/shell/Pan.ts`); `pan` stays for a pan to a place (the reset, a restore).
* **The run** (`crates/desk-wm/src/pan.rs`, `WheelLatch`; `apps/desk/shell/src/compositor_window/pan.rs`):
  a `pan-by` from the page begins a run at the pointer. A wheel of the run pans in the shell, in the
  turn of the event loop it arrives in, and reaches no page. The run ends 500 ms after its last wheel,
  once the pointer is more than 10 CSS pixels from where the run began, when a button goes down or
  while Control is held. Both numbers are Chromium's for keeping a mouse wheel's scroll with the
  scroller it began on (its wheel latching transaction and slop region), so a pan ends when a scroll
  in a page would. The run keeps the pan before whole device pixels: a wheel of less than a pixel
  counts toward the next.
* **The extent** (`pan::EXTENT`, `pan::bounded`, `Desk::set_pan`): a canvas goes 100,000 CSS pixels
  from its origin either way on each axis, some fifty 4K screens across. A wheel, a drag, the map, a
  reveal, an edit and a restored session all keep a pan through `bounded`. A step that leaves the pan
  where it is (past the extent, less than a pixel) publishes nothing.

### Consequences

* Good, because a wheel's distance is the canvas's: 12 wheels of 60 px moved it 720 px, and 40 wheels
  of 30 px 8 ms apart 1200 px, each with windows passing under the pointer (the headless desk, fed
  as winit's events)
* Good, because a pan no longer waits for the page between wheels: the page hears the published
  desk, and lays it out, after the windows have moved
* Good, because a pan cannot lose the windows
* Bad, because for half a second after a pan a wheel over a window still pans, unless the pointer
  moved to it
* Bad, because a window placed past the extent by an older session cannot be revealed; the pan stops
  at the extent and `reveal` answers false
* Neutral, because the frame clock is still the desk's 60 Hz (`web_host/frames.rs`): a display that
  refreshes faster is not followed yet

## More Information

`crates/desk-wm/tests/pan.rs` (`the_canvas_extent`, `a_wheels_run`),
`packages/runtime/src/shell/Pan.test.ts`, `e2e/specs/windows-canvas.spec.ts` (a wheel's run pans on
once a window comes under the pointer). ADR 0082 (the canvas), ADR 0150 (the compositor routes
input), ADR 0158 (desk-wm holds the state), ADR 0209 (whole device pixels).
