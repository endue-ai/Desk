---
status: accepted
date: 2026-11-10
decision-makers: Team endue
---

Status: amended by ADR 0157: Chromium runs its full pipeline, prompt frames come from the press until
its paint, and a surface long idle takes at most 10 desk frames a second.

# Web surfaces paint on the desk's frame clock, with external begin frames

## Context and Problem Statement

In compositor mode (ADR 0149) every web surface is a windowless CEF browser, and #52 let each one
drive its own frames: CEF's internal begin frames at its windowless frame rate. #58's gates found the
cost: memory per live surface read 162 to 191 MiB against #35's 120.7 MiB ± 20 %, the GPU process
growing about 120 MiB a surface where the PoC's (`spikes/compositor`, which sent one
`SendExternalBeginFrame` per desk frame) grew about 63. How should the surfaces' frames be driven so a
live surface costs what the live budget (ADR 0142) assumes, while animations, video, WebGPU and the
paint after a press still come promptly?

## Decision Drivers

* Memory per live surface back within #35's band (`just perf-compositor`)
* One clock: what the surfaces paint follows the desk's frames, not each browser's own timer
* #52's rules kept: a hidden surface paints nothing, a sleeping one has no renderer, `pace` caps a
  surface's rate
* #58's input budgets (RT-16): a press to its paint, and to the composed frame holding it

## Considered Options

* External begin frames from the desk's frame clock, with prompt frames after input
* External begin frames on the desk's frames only, nothing after input
* Internal begin frames at a lower windowless frame rate

## Decision Outcome

Chosen option: "external begin frames from the desk's frame clock, with prompt frames after input",
because it brings the memory back to #35's number (121.1 to 130 MiB a surface measured, against
179.5 on main the same day) and keeps a press's paint within a few milliseconds of the internal
clock's at the median.

* **Every windowless browser** (each plugin surface and the compositor's shell page) is made with
  `external_begin_frame_enabled`: its page renders only on the begin frames the desk sends.
* **The clock** (`apps/desk/shell/src/web_host/frames.rs`, sent by `clock.rs`) ticks once a desk frame
  (60 Hz) while a surface is on it and stops when none is. Each tick is a begin frame for every
  visible, awake surface its pace takes: `pace` (#52's `SetWindowlessFrameRate` hint, still set for
  CEF's capture) becomes a skip rule, 30 fps every other frame, 10 every sixth. Hidden, asleep and dead
  surfaces are not on it, nor is the page while the window is occluded. The compositor window looks at
  the clock after CEF's work on every turn of its event loop and wakes for its next look; the surface
  probe drives the same clock.
* **Prompt frames.** Each step of a paint (the renderer's frame, the display's draw, the capture) waits
  for a begin frame, so a press on an idle page would wait for two or three desk frames. A press, a key,
  a composition or a focus change that reaches an idle surface's browser (nothing painted for two
  frames) is followed by a begin frame every 1 ms from 3 ms on, for two frames, whatever its pace. A
  surface that paints already takes every desk frame and gets none. Moves and wheels come in streams
  and paint on the desk's frames. Input reaches a browser through `web_host/input.rs` from the host and
  from the compositor's page alike, so the presses are noted there and the clock takes them.
* **The probe waits as the window does**: it parks its thread and CEF's schedule unparks it
  (`pump.rs`), where it slept 1 ms between steps. With the browser's main thread in every step of a
  paint, that sleep made most presses a frame late.

### What the measures found (macOS, M4 Max, the same binary switched between the two, 60 presses)

* Internal begin frames: a press to its paint 6.7 ms at the median, 9.4 at p95. External with the
  prompts above: 7.2 to 7.4 ms and 16.5 to 20; one press in ten waits about a frame more.
* A begin frame sent before the renderer has the press delays the paint (the first one at the press:
  a median of 13 ms); prompts that stop at the paint, or run for 50 ms, left two to three times as many
  presses a frame late as two frames do. Cadences of 2 and 4 ms did no better than 1.

### Consequences

* Good, because memory per live surface is within the live budget's assumption again, so N = 8 holds.
* Good, because what every surface paints is paced by one clock, and a hidden or sleeping surface gets
  no begin frame at all (the lifecycle probe counts them).
* Bad, because a press's paint on an idle surface has a tail the internal clock did not: `just
  perf-compositor`'s p95 of 16 ms passed three runs in seven on a loaded reference machine (12.1 to
  22.3 ms, load average 3 to 7), where main read 9.5. Its median held (7.2 to 8.5 ms); the composed
  frame's median read 13.9 to 17.9 ms, within 16 in four runs of seven (main 17.2 the same day). Why a
  prompt sometimes waits a frame is not known; CEF's tracing wrote no file here.
* Bad, because the clock wakes the desk 60 times a second while any surface is shown, even if nothing
  changes: a begin frame to a page with nothing to draw costs a round trip to the GPU process, not a
  paint. Slowing the clock for surfaces idle a long while is left for later.
* Bad, because a paint now needs the browser's main thread at each step: a busy event loop delays the
  surfaces' frames, where the internal clock ran in the GPU process.

## More Information

Issue #111 (epic #32 §8), found by #58. Builds on ADR 0149 (whose **pace** it changes) and ADR 0142.
Code: `apps/desk/shell/src/web_host/{frames,clock,input}.rs`, `apps/desk/shell/src/compositor_window/
clock.rs`, `apps/desk/shell/src/pump.rs`, `apps/desk/shell/src/probe.rs`. Tests: `web_host/frames.rs`,
`apps/desk/shell/tests/lifecycle.rs` (no begin frame hidden or asleep; the clock held, an animating page
paints nothing), `tests/budgets.rs` through `just perf-compositor`. No section of
`docs/ko/desk-structure.md` changes.
