---
status: accepted
date: 2026-11-11
decision-makers: Team endue
---

Status: amended by ADR 0162: a press on a desk at rest waited for the GPU's first copies after a
second or more without one, and input to a cold desk now wakes them first. Amended by ADR 0164:
a resting surface takes no begin frames, so CEF's answers to them no longer wake a desk at rest.

# CEF's poll rides the desk's own wake-ups, and a stand-in clock covers CEF's busy-wait

## Context and Problem Statement

ADR 0157 left two costs in the shell's pump (`pump.rs`). It woke the desk at least every 33 ms
whatever the frame clock did, as cefclient's `kMaxTimerDelay`, so a desk at rest woke about 55 times
a second. And `do_message_loop_work` sometimes ran for 10 ms where it usually takes a fraction of
one, holding a press it caught (none to two in twenty in #117's traces). #129 traced both. CEF asks
for work through `OnScheduleMessagePumpWork` only when it is due now (in a rest run's 869 calls it
never asked for a later time): Chromium does not announce a task it delays from inside its own work
(a timer, a deadline), which is what the poll is for. And CEF 156's `MessagePumpExternal::Run` calls
`DoIdleWork` whenever nothing is due now; that quits the `RunUntilIdle` loop of
`CefDoMessageLoopWork`, the pump ignores the quit, and a call that goes idle while a delayed task is
due within its 10 ms slice loops until the slice ends (thousands of `DoIdleWork` a call), running
what comes due meanwhile. Nothing outside CEF says when a delayed task is due. How does a desk at
rest sleep, and how does a press caught by that loop still paint at once, without patching CEF?

## Decision Drivers

* Fewer wake-ups and less CPU at rest, measured (`just perf-compositor`'s `deskAtRest`)
* RT-16 holds: a press to its paint within 16 ms at p95, the composed frame's median within 16 ms
* No patch to CEF or Chromium (ADR 0157); the PoC's finding 1: call CEF's work when it asks
* A task Chromium delays from inside its work must still run, late by a bounded time only

## Considered Options

* The poll rides the desk's own next wake-up at rest; begin frames from a stand-in thread while
  CEF's work runs long
* Sleep until CEF's next due time as announced: it announces none of its delayed tasks, so they
  would wait for the next input
* A fence task posted to learn whether CEF has a delayed task due earlier: CEF announces it when it
  becomes the earliest, but the fence is itself a delayed task, so every call within 10 ms before it
  busy-waits for it
* A task always delayed far ahead (an anchor): CEF 156 goes idle with delayed work pending anyway
* The frame clock on a thread of its own always: every begin frame then takes a hop through CEF's
  queue and a wake of the event loop, where the stand-in costs nothing until a call runs long

## Decision Outcome

Chosen option: "the poll rides the desk's own next wake-up, with a stand-in clock", because the
desk at rest wakes about a third less often, and a press caught by CEF's busy-wait has its paint
when the call returns rather than about 4 ms after.

* **The poll** is due `MAX_DELAY` (33 ms) after the last call while the desk wakes more often than
  that, and at the desk's own next wake-up (the frame clock's next look, a frame to draw) when that
  is later, at most `REST_DELAY` (100 ms, the slow clock's period) after the last call. A desk at rest
  wakes for its clock's looks and for CEF's asks, which those looks bring (each begin frame's
  answer), and polls on the look's wake-up.
* **The stand-in** (`pump/stand_in.rs`): when a call starts while a press is not looked at yet, or
  while the clock runs at the desk's rate or faster and looks within the call's slice, a thread wakes
  for that look. If the call still runs then, and has run 1 ms, it looks at the clock itself, and at
  each look the clock wants until the call ends; CEF posts its begin frames to the UI thread, where
  the busy-wait runs them. The event loop waits for a look in progress before it looks again.
* **The probe** (`probe/rest.rs`, `probe/input_gate.rs`) counts the desk's wake-ups and CEF's work
  calls at rest, the processes' CPU and OS wake-ups, and presses caught on purpose: a task delayed
  5 ms after the press, and CEF's work run at once, make that call busy-wait.

### What the measures found (macOS, M4 Max, load average 3 to 6)

The surface probe, five runs each of this change and of main's pump (the same build with the 33 ms
poll and no stand-in), one after the other:

* At rest (three still surfaces, long idle): the desk's loop woke 34.6 to 36.7 times a second, its
  browser process 30.7 to 30.9 times (OS wake-ups), 1.0 to 1.9 % of a core; main's pump 54.6 to 57.7,
  50.5 to 50.8 and 1.2 to 2.1 %. CEF's work took 4.3 to 8.0 ms a second against 7.0 to 11.6.
* Five presses a run caught on purpose: their paint 10.2 to 12.4 ms after the press at the median,
  13.7 to 16.4 with main's pump; in two runs that timed it, 0.01 to 0.02 ms after the busy-wait
  ended, against 4.1 to 5.0.
* `just perf-compositor`, five runs at a load average of 8 to 13: a press to its paint 5.3 to 12.2 ms
  at p95 (two presses caught by chance in the 12.2), its composed frame 13.0 to 15.5 at the median,
  116.5 to 119.1 MiB a surface; a caught press's paint 0.01 to 0.04 ms after the busy-wait (0.92 in
  a sixth run); the desk at rest 33.2 to 38.3 wake-ups a second, 0.8 to 1.5 % of a core.

### Consequences

* Good, because a desk at rest wakes about 20 times a second less, and a caught press's paint no
  longer waits for the busy-wait to end before it starts.
* Good, because the probe gates both: the desk's wake-ups at rest under a budget, and a caught
  press's paint within 2 ms of the busy-wait's end.
* Bad, because at rest a task Chromium delays from inside its work runs up to 100 ms late, not
  33 ms; a press or a paint brings the 33 ms poll back within a frame.
* Bad, because the busy-wait itself stays: the event loop still waits for it, so a caught press's
  composed frame and any OS event in the meantime wait up to 10 ms. Only CEF can end it (honouring
  the quit, or not idling with delayed work due).
* Bad, because each long-idle surface's begin frames (ten a second, ADR 0157) bring CEF's answers,
  most of what still wakes a desk at rest: three surfaces, about 25 wakes a second.
* Bad, because a press on a surface long idle took 8 to 25 ms to paint on main and on this change
  alike, against 5 ms on one idle for less than a second; not explained here.

## More Information

Issue #129 (epic #32 §8), found by #117. Amends ADR 0157 (the pump at rest). Code:
`apps/desk/shell/src/pump.rs`, `pump/stand_in.rs`, `window.rs`, `compositor_window/clock.rs`,
`web_host/frames.rs`, `probe/{rest,input_gate,desk_loop}.rs`. Tests: `pump_tests.rs`, the stand-in's,
`tests/budgets.rs` through `just perf-compositor` (`deskAtRest`, `inputToPaint.caughtWaitMs`),
`e2e/perf/lib/compositor.test.ts`. No section of `docs/ko/desk-structure.md` changes.
