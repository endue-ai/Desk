---
status: proposed
date: 2026-11-16
decision-makers: Team endue
---

Refines the desk's frame clock (#111, #117, ADR 0231) under ADR 0205's compositor.

# A browser gets no begin frame while its last one is out

## Context and Problem Statement

Every off-screen browser of the desk renders only on the begin frames the shell sends it
(`SendExternalBeginFrame`, `apps/desk/shell/src/web_host/clock.rs`). Chromium's display takes one
external begin frame at a time. A second one that comes before the first has ended is a bad message,
and the GPU process that receives it exits ("Received bad user message: Got overlapping
IssueExternalBeginFrame", exit code 5).

The start-up spec of `just perf-app` (#339) opens six files on a first start. On 2026-11-16 the GPU
process died that way just after Sheets loaded. A few seconds later the desk's page stopped painting
(#157), and the desk said it would quit to start again. Docs, the sixth opener, never loaded, and the
spec waited for mocha's ten minutes. CEF reports no frame's end, and the clock sent each browser a
begin frame whenever its pace took one, prompt frames a millisecond apart included.

How does the clock keep to one begin frame at a time without a signal for a frame's end?

## Decision Drivers

* A begin frame that overlaps the last must never reach Chromium's display
* A page that paints keeps every frame its pace takes; motion stays as the motion gate measures it
* No new millisecond threshold without a measurement here (AGENTS.md, ADR 0208)

## Considered Options

* Hold a browser's next begin frame until its page painted or one desk frame passed
* Hold it until its page paints, however long that takes
* Leave the clock as it is and catch the GPU process's exit

## Decision Outcome

Chosen option: "until its page painted or one desk frame passed", because those are the two ways a
begin frame ends that the shell can see. A frame with something to draw ends with its paint. A frame
with nothing to draw ends at its deadline, one desk frame on (ADR 0231). `FRAME` is the clock's
existing desk frame, not a new constant. Holding until a paint alone would starve a page that has
nothing to draw: a caret between blinks, a page waiting for a press. Catching the exit leaves every
page without frames while the GPU process starts again, which is what stopped the desk's page.

* `Flight` (`web_host/frames_flight.rs`) keeps when a browser was last sent a begin frame and its
  paints then. `View::begin_frame` sends, or says until when it holds. `clock.rs` sends none while
  one is out, and looks again when the hold ends.
* `counts.held` counts the begin frames held, beside `begin_frames`, in the compositor's stats.
* A browser created or loaded again has nothing out (`View::restart`).
* The start-up spec gives each of its six opens a minute (`DeskSocket.runWithin`). A desk that
  never answers fails the spec with the file's name, not mocha's timeout.

### Consequences

* Good, because the shell no longer sends a begin frame that the GPU process exits on
* Good, because `counts.held` shows how often the hold acts, where motion and start-up are measured
* Bad, because a prompt frame after a press waits for the last frame's paint or end, where it went a
  millisecond after the last before (ADR 0231). The motion gate and the input numbers say what that
  costs.
* Bad, because a frame with something to draw that takes longer than a desk frame to paint can still
  overlap: the hold ends at `FRAME` without a paint. If the GPU process still exits on overlapping
  begin frames, that case is the one to look at next

## More Information

Issue #339; the log is `measure-312`'s `startup.perf.ts.log` of 2026-11-16 13:42 (main 55ed3326,
debug bundle, a machine at a high load).

`frames.rs` says that CEF sends no begin frame while one is out, yet the GPU process received
overlapping ones. The hold makes the rule the shell's own, wherever CEF's lapses.

To be measured before this ADR is accepted, on a quiet machine:

* `just perf-app`'s start-up spec, two runs: whether all six opens answer, whether the GPU process
  exits, `counts.held`, and the medians of `readyMs` and `firstFrameMs`. Those medians go into
  `e2e/perf/budgets.json`'s `startup` once #312 (PR #340) has merged.
* `just perf-motion` against `main`: the motion gate's verdicts and `counts.held` while windows move.
