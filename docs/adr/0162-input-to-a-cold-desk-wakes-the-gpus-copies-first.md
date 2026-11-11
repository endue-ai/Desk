---
status: accepted
date: 2026-11-11
decision-makers: Team endue
---

# Input to a cold desk wakes the GPU's copies first

## Context and Problem Statement

A press on a desk at rest painted 8 to 25 ms after it, where a press on a busy desk painted in 5
(ADR 0159's last consequence). ADR 0157's slow clock, the renderer's idle state, the GPU's power
state and CEF's scheduler were the suspects. #133 traced presses from rest with the probe
(`DESK_PROBE_TRACE`) and pressed after rests of 0.05 to 3 s. Presses after 1 s or less took 4.4 to
6.0 ms, after 1.5 s or more 9.6 to 24 ms. In the slow ones the prompt frames came at once, the
renderer handled the press within 0.5 ms and the display drew by 1.6 ms, as on a busy desk. Every
millisecond more was a GPU copy. Chromium's capture copies the page's frame into a shared texture in
its GPU process, and viz looks for that copy's end every 2 to 2.5 ms: on a busy desk it is over at
the first look, on a desk at rest at the second or later. Then the desk copies the frame into
the compositor's own texture (`desk-compositor`'s attach), waited for in CEF's paint callback: 0.2
to 0.7 ms on a busy desk, 2.5 to 4 ms on one at rest. How does a press on a desk at rest paint within
RT-16's 16 ms, without keeping the GPU awake at rest?

## Decision Drivers

* RT-16 on a desk at rest: a press to its paint within 16 ms at p95 (`just perf-compositor`)
* A desk at rest costs no more than it does now: no work while nobody uses it (#134)
* No patch to CEF or Chromium (ADR 0157)

## Considered Options

* Wake the GPU with a copy of the desk's own, when input reaches a desk that painted nothing for a
  while
* The slow clock off for long-idle surfaces: the presses were as slow with every surface on every
  desk frame
* Keep the GPU awake at rest with work every 100 ms: a render pass did not keep the copies awake, and
  a copy, which did, is work at rest every 100 ms for good
* `Invalidate` a neighbour at the press so Chromium's GPU process copies early: its capturer gives the
  last frame again without a copy, and the desk's copy of that one ran cold on the UI thread, 3.4 ms
  in front of the press's own

## Decision Outcome

Chosen option: "wake the GPU with a copy of the desk's own", because it starts the GPU's wake-up at
the press, while the page handles it, at the cost of a copy of a few pixels.

* **When.** Each paint the web host takes is a copy, and the clock tells `web_host/copy_wake.rs`
  when it saw one. Input about to reach a browser (`input::deliver`, `press_tab`) of a desk that
  painted nothing for `COLD` (500 ms, `web_host/frames.rs`'s `Copies`) wakes the copies once, before
  CEF hears the input. A wake-up counts as a copy, so a stream of moves wakes them once.
* **How.** A thread of the web host's, started with it, copies 64 by 64 pixels between two textures
  of its own on the compositor's device and does not wait. On the UI thread the same copy took about
  2 ms on a desk at rest, with the press's begin frames behind it.

### What the measures found (macOS, M4 Max, `idle-input`: twelve presses after 2 to 3 s at rest)

* Main, six runs at a load average of 2.5 to 6: a press to its paint 10.0 to 16.9 ms at the median,
  10.2 to 23.3 at p95, over 16 in four runs. This change, nine runs at 2.5 to 8: 8.3 to 14.7 and 12.9
  to 16.1, within 16 in eight (16.07 once). Run by run with the wake-up off and on, three pairs at
  2.5 to 5: 14.4 to 16.9 against 11.3 to 13.4 at the median, 16.5 to 23.3 against 13.9 to 16.1 at p95.
* The desk's own copy of a press's frame waits 0.4 ms again. Chromium's still ends at viz's second to
  fourth look: the GPU wakes no sooner than it can. On a quiet machine a copy of a few pixels after a
  rest took 4 to 13 ms to finish; at a load average of 6 to 8, presses painted in 7.4 to 8.2 ms at p95.
* What moved the gate since (#148, 2026-11-11): the machine's cores, not the desk. The gate read 8.0
  to 8.4 ms at p95 in #134's runs and 15.1 to 21.6 later the same day at like load averages, on main
  too: a load average says too little of what the cores do at a press. Run by run at a load average
  of 4 to 8 the presses painted 5.8 to 15.8 ms after them (p95 12.9 to 15.2); with one busy loop
  anywhere on the machine (`yes`, another process) 6.5 to 7.8 (p95 7.4 to 7.6), and with six 6.3 to
  7.4. A press's path wakes threads in three processes (the desk's, the renderer's, the GPU
  process's), and on a machine with a core running they wake and run sooner. A core kept busy by the
  desk from the press on (the wake-up thread spinning at the user-interactive class until the paint,
  at most 20 ms) did not help: p95 13.9 to 16.1 at a load average of 4 to 5, so it was not kept.
  Keeping a core busy at rest would pass the gate and cost every desk at rest a core: not done. The
  probe now presses once first, not counted, then three blocks of twelve, and the gate reads the
  block whose p95 is the median, so a burst of other work on the machine during one block, or its
  end, does not decide a run.

### Consequences

* Good, because a press on a desk at rest paints within RT-16's 16 ms, and the probe gates it.
* Good, because nothing runs at rest: the wake-up comes with input, at most once in 500 ms.
* Bad, because the GPU's own wake-up stays the floor of a press from rest, and on a quiet machine it
  leaves little room under 16 ms (13.9 to 16.1 at p95). Only an earlier start helps: pointer moves on
  the way to a press wake the copies, a press with no move before it does not.
* Bad, because Chromium's GPU process still meets its first copy cold: one or two more of viz's looks
  than on a busy desk, which only Chromium can change.
* Bad, because the cores' own wake-up is the rest of the floor (#148): a press from rest paints in
  about 7 ms on a machine with a core busy and 9 to 16 on a quiet one, and only the machine decides
  which. The gate's margin on a quiet machine stays small.

## More Information

Issue #133 (epic #32 §8), found by #129. Amends ADR 0159 (its last consequence explained). Code:
`apps/desk/shell/src/web_host/{copy_wake,frames,clock,input}.rs`, `probe/idle_input.rs`. Tests:
`web_host/frames_tests.rs`, `tests/budgets.rs` through `just perf-compositor` (`inputFromRest`),
`e2e/perf/lib/compositor.test.ts`. No section of `docs/ko/desk-structure.md` changes.
