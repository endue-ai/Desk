---
status: accepted
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

Measured on 2026-11-21 (#370) on the reference machine (Mac mini M4, macOS 26.2), main a6a50ba9.
No quiet window was to be had (other sessions were building), so each number says its load:

* `just perf-app`'s start-up spec, a debug bundle with chromedriver attached, three runs of a first
  start that opens six files and three relaunches each, started at a 1-minute load of 4.2, 9.5 and
  6.8. In every run all six opens answered, and every relaunch's trace had the six `mount <plugin>`
  phases. The desk's log (runs two and three; the first run's was overwritten) holds no "Got
  overlapping IssueExternalBeginFrame" and no exit of the GPU process. The medians of the
  relaunches: `readyMs` 1838.5, 1840.4 and 1993.1; `firstFrameMs` 1851.1, 1860.8 and 2008.4. The
  first two runs' medians, 1839.5 and 1856, are `startup`'s baselines in `e2e/perf/budgets.json`.
  `counts.held` (read from `compositor_stats` over DevTools every 2 s): 991 begin frames held of
  2,107 sent by the first start's last read, and 270 of 588 by a relaunch's; most are held at the
  start, while pages load and paint.
* `just perf-motion`, optimized offscreen, on `main` 1f206027 (its shell is a6a50ba9's), three runs
  at a load of 5.6, 3.5 and 3.6: fps 59.6,
  smooth 2.1 % (p95 23.1 ms, over its 2 % by a tenth, as on `main` all day: 2.1 to 3.4 % at loads
  of 4 to 48, 1.3 % at a load of 3), own-pixels 0, painting none, soft 1; the sway's checks pass
  but the known `sway-smooth` (11.8 %, #249); the loop stopped one page in one run (#345). The
  trace's `held` lines, the begin frames the clock held while windows moved: 546, 534 and 580 a
  run, against about 2,000 desk frames each. Against the gate's baseline from before the hold
  (`e2e/perf/motion.json`, 6e75d95e of 2026-11-13: fps 59.6, long intervals 1.7 %), fps is the
  same and the long intervals within the day's spread, so the hold costs no frame the gate counts.

The GPU process did not exit with the hold in place, so this decision is accepted.
