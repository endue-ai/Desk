---
status: accepted
date: 2026-11-11
decision-makers: Team endue
---

# Web surfaces run Chromium's full pipeline, and long-idle ones rest on a slower clock

## Context and Problem Statement

With external begin frames (ADR 0152) a press's paint read 12 to 22 ms at p95, against #58's 16 ms,
and one press in ten waited a frame more although its surface got a begin frame every 1 ms from 3 ms
on. The clock also woke the desk 60 times a second while any surface was shown. #117 traced it with
CEF's tracing, which writes a file only when its end has a callback and the message loop runs until
the callback comes (the surface probe's `DESK_PROBE_TRACE`). CEF sends no begin frame while one is
out (`begin_frame_pending_` until the display finishes it), and Chromium's display, finding no
damage, holds a begin frame until its late deadline, its frame time plus the 16.7 ms interval CEF
always sends. The clock sent idle surfaces one every desk frame, so in six of twenty traced presses
one was out when the press came; every prompt frame was dropped until it ended, and the renderer,
asking for frames late, dropped the one in flight (its deadline from CEF is zero). How do a press's
frames reach an idle page at once, and how does a desk at rest stop waking 60 times a second?

## Decision Drivers

* RT-16: a press to its paint within 16 ms at p95 in five runs of five, on a loaded machine too
* Memory per live surface within #35's band (ADR 0152's reason for external begin frames)
* No patch to CEF or Chromium; the clock stays the desk's (ADR 0152)
* An idle page's own changes still show; fewer wake-ups at rest

## Considered Options

* Chromium's full pipeline (`--run-all-compositor-stages-before-draw`), prompt frames from the press
  until its paint, and a slower clock for long-idle surfaces
* Fewer begin frames to idle surfaces only: a press still finds one out a share of the time (one in
  six at 10 a second), and an idle page's own change waits a period
* Flush the begin frame out on a press with `Invalidate`: the capturer delivers an unchanged frame
  again without a copy, so the display sees no damage and keeps waiting
* A higher windowless frame rate for a shorter interval: CEF sends the default interval whatever the
  rate (16 666 µs measured at 240)

## Decision Outcome

Chosen option: "Chromium's full pipeline", because it removes the wait at its cause: a display with
no surface still drawing ends its begin frame at once, so the next one goes out, and a renderer
that asks for frames late takes the one in flight.

* **The switch** (`app.rs`) is on in every process: the display waits for the surfaces it sent a
  begin frame to rather than for a deadline, and each compositor waits for each stage of a frame.
* **Prompt frames** (`web_host/frames.rs`): a press, a key, a composition or a focus change on an
  idle surface brings a begin frame every 1 ms from the press until it paints, two frames at most.
  Without the full pipeline the same prompts read a median of 17 to 22 ms: the two go together.
* **Desk frames are numbered** from the clock's start. A surface that painted and heard nothing for
  a second takes at most 10 a second, on frames every long-idle surface shares, and the clock looks
  next at the soonest frame any surface takes: ten times a second at rest. Input of any kind, a
  compositor message for it and a message to its page (`host::send`) wake it onto every frame.
* **The probe** asks for a press's paint right after CEF's work, before its wait, as the window
  composes then.

### What the measures found (macOS, M4 Max, `just perf-compositor`, the same hour)

* This change, five runs at a load average of 5 to 8: a press to its paint 4.4 to 6.6 ms at the
  median, 4.9 to 9.2 at p95; to its composed frame 13.5 to 14.7 at the median; 117.5 to 119.7 MiB a
  surface. Main, three runs at 6 to 11: 7.2 to 7.3, 9.4 to 14.2, 15.2 to 15.8, 121.0 to 121.9.
* An idle surface beside two animating ones got 10 begin frames in a second at rest, where the
  clock sent 60 and about half reached it.

### Consequences

* Good, because a press's paint takes a few milliseconds whatever the moment, and its p95 holds
  with room to spare.
* Good, because a desk at rest wakes for its clock ten times a second, not sixty.
* Bad, because the switch is Chromium's, for every browser, the windowed palette, Eris and banner
  too: animations a compositor runs wait for a main frame it asked for, so a long task stalls them,
  and a busy renderer's display waits for its frame (only that surface gets no begin frame meanwhile).
* Bad, because a long-idle page's own change (a timer, a fetch) waits up to 100 ms for its frame.
* Bad, because CEF's external pump still spins up to 10 ms in `do_message_loop_work` when delayed
  work is due within its time slice (`MessagePumpExternal`), and a press it catches waits that much
  more: none to two presses in twenty in these runs, which neither the clock nor the switch touches.
  CEF's pump also still wakes the desk every 33 ms (`pump.rs`).

## More Information

Issue #117 (epic #32 §8), found by #111. Amends ADR 0152 (the prompts' timing, the clock at rest).
Code: `apps/desk/shell/src/app.rs`, `web_host/{frames,clock,input}.rs`, `web_host.rs`, `host.rs`,
`compositor_window/clock.rs`, `probe/{trace,desk_loop}.rs`. Tests: `web_host/frames_tests.rs`,
`tests/{lifecycle,isolation}.rs`, `tests/budgets.rs` through `just perf-compositor`, the app e2e. No
section of `docs/ko/desk-structure.md` changes.
