---
status: accepted
date: 2026-11-14
decision-makers: Team endue
---

Supersedes ADR 0157's choice of Chromium's full pipeline (its slower clock for long-idle surfaces and
its prompt frames stay). Amends ADR 0159, ADR 0162 and ADR 0165 where they hold a press to RT-16's
16 ms: the measured budgets below hold it instead, and 16 ms stays the target (#249).

# Web surfaces leave Chromium's full pipeline, and the desk catches a page up

## Context and Problem Statement

On 2026-11-13 a person's live resize stopped the desk's own page for good ("stopped painting ...
through 167 begin frames (#157)"), and ADR 0202 could only quit the desk and start a new one. #258's
gate grows and shrinks the app window while a window moves (ADR 0213) and found the same stall in
some runs on `main` 6e75d95e; #248's loop (the app window resized by four sizes and a plugin window
maximized or restored, a turn every 100 ms) found it in every run, within 24 to 33 turns. Plugin
pages also stopped in that loop and were loaded again by the stall watch. The person's standard
for every window change is exactly this case. Why does the desk's page stop, and how does every page
keep painting while windows and the app window change size, as fast as hands go?

## Decision Drivers

* No desk page that stops and no ADR 0202 restart, in the sway and the loop, every run
* No plugin page the stall watch has to load again
* A press to its paint as fast as the first two allow; RT-16's 16 ms stays the target
* No patch to CEF or Chromium; the desk's clock stays the desk's (ADR 0152)

## Considered Options

* Drop the full pipeline everywhere, and catch up a page that missed its size or its frames
* Keep the full pipeline and catch up the plugin pages: the desk's page still deadlocks
* The full pipeline in renderers only
* A begin frame of the desk's own, or a resize beat, to end the desk page's wait

## Decision Outcome

Chosen option: "drop the full pipeline everywhere, and catch up a page", because the desk's page
stopped inside the full pipeline's own wait, where nothing the desk can call ends it, and without the
pipeline every begin frame ends by Chromium's deadline; what is left (a page that missed a size or
its frames) the desk can see and answer, and a press's first frame waits a few milliseconds instead.

* **Why the desk's page stopped.** With `--run-all-compositor-stages-before-draw` in the browser
  process, Chromium's display (`DisplayScheduler`) drops its deadlines: where it would wait for a
  begin frame's late deadline (`kLate`) it waits with none (`kNone`) for every surface it sent the
  begin frame to, its root among them. After the app window's resize the root's frame at the new
  size was what it waited for, and it did not come. CEF 156 (branch 8078) sends no begin frame while
  one is out (`begin_frame_pending_`, set in `SendExternalBeginFrame`) and clears that only in the
  display's answer (`OnFrameComplete`), so the desk's clock went on calling and no begin frame went
  out again, for good. Single resizes of the app window to alternating sizes 100 ms apart deadlock it
  as well (within 40); maximizes of plugin windows alone do not. A catch-up (below), a resize beat
  (each resize at a clock look of its own, no begin frame sent with it) and a begin frame of the
  desk's own neither prevented nor ended it; only a new page did (ADR 0202).
* **The switch** (`apps/desk/shell/src/pipeline.rs`, `app.rs`): off in every process. A development
  build measures the others with `DESK_FULL_PIPELINE=all|renderers|none`; the browser's choice goes
  to each child at its launch.
* **Catch-up** (`web_host/catch_up.rs`): a resize reaches a page's renderer one size at a time, and
  CEF holds a view's next size until a paint at the one before. In the loop a page now and then
  kept a size between a glide's ends and painted nothing more. A shown view whose page has not
  painted its size 250 ms after its last paint, with 3 begin frames sent meanwhile, hears its screen
  and size again (`NotifyScreenInfoChanged`, `WasResized`), up to 3 times a paint; that sends the
  size past CEF's hold. Of a resize, a hide and show in one call, an invalidate, a begin frame of the
  desk's own and a new frame rate, none brought such a page back.
* **The stall watch tells first** (`web_host/clock.rs`, `stall.rs`): a page can also stop at its own
  size (one painted nothing for 3 s through 118 begin frames). Its asks for frames that come again
  through begin frames, a second and two seconds in, now tell its browser the same. At the second, a
  plugin's page is also hidden and shown again on CEF's next task, laid out and painted whole, as a
  page shown again after others is (`popup_room.rs`): in one run a page kept a size from between a
  glide's ends through five tellings. Only a page that still paints nothing at the third is loaded
  again (ADR 0170), and the desk's page restarts the desk (ADR 0202). Each telling is counted
  (`caught_up` in `compositor_stats`) and traced with why (`size`, `asked`, `shown`).
  `DESK_CATCH_UP=off` (development builds) turns them all off, to compare.
* **A press's first frame** (`web_host/frames.rs`, `PROMPT_AFTER`, `PROMPT_AFTER_REST`): without the
  full pipeline, a begin frame the display gets before the page has handled the press is held to its
  deadline, a desk frame on, and CEF sends none meanwhile, so a press's prompts from the press on
  (ADR 0157's) lose that frame. They now start 2 ms after the press, and 16 ms after it on a surface
  at rest (`Pacing::long_idle`), whose page takes longer to wake. The surface probe without the full
  pipeline, its prompts' first delay set by hand (a load average of 3 to 25): a press beside two
  animating surfaces (`perf_input_to_paint`, the median of four to six runs a delay) painted 18.2 ms
  after it at the median with its prompts from the press, 6.4 at 1 ms, 7.1 at 2, 7.9 at 3 and 9.5 to
  11.8 at 4 to 6; at p95 22.5, 21.3, 18.3, 19.3 and 18.7 to 20.0 (each run's p95 is its second
  slowest of twenty, so runs at one delay spread 4 to 8 ms); the desk's frame holding it, at the
  median, 23.2, 15.7, 14.5, 15.7 and 17 to 18. A press on a desk at rest (`perf_input_from_rest`,
  one run a delay, two at 16) read 35.5 to 35.9 ms at p95 with its prompts at 0, 2, 3, 5 or 8 ms,
  36.0 at 12, 29.1 at 14, 28.4 and 29.3 at 16, 31.0 at 20.
* **The budgets** (`e2e/perf/budgets.json`): set from what this change measured, each with its
  margin. A press to its paint, p95: 23 ms, the median of seven runs (18.3) plus 25 %, as a run's p95
  is its second slowest of twenty and moves 4 ms run to run. Its composed frame, the median: RT-16's
  16 ms still (13.3 to 16.0). A caught press's wait after CEF's busy-wait (ADR 0159): 2.7 ms, the
  slowest of seven runs (2.16) plus 25 %, as a run's median of five lands near 0 or near 2 ms. A
  press on a desk at rest, p95: 32 ms, four runs' median (29.2) plus 10 %, so that prompts from the
  press (35.5 to 35.9) fail it. The report prints RT-16's 16 ms beside them, the target.
* **The gate** (`just perf-motion`, ADR 0208, ADR 0213): after the sway, the resize loop
  (`e2e/perf/motion-loop.ts`): the app window resized by four sizes at once and a plugin window
  maximized or restored, each in turn, a turn every 100 ms, 100 turns, then a poke. Check `loop`: no
  page that stops painting in or after it, the desk's own included, and no restart; catch-ups are
  counted, not failed. The desk is captured at the middle turn and once it rests (`loop-mid.png`,
  `loop-rest.png` beside each run's trace).

### Turning the full pipeline back on

Only with a CEF or Chromium where the deadlock above cannot happen: run
`DESK_FULL_PIPELINE=all just perf-motion --runs 5` (the gate's build keeps debug assertions, so the
variable reaches the desk; `DESK_CATCH_UP=off` beside it measures the desk without the catch-up). On
`main` 6e75d95e plus this change's loop the desk's page stopped in every run, within 24 to 33 turns,
and the desk started again. It must pass the loop and the sway in every run, and
`just perf-compositor` must show the press it buys back. Nothing is filed upstream.

### Consequences

* Good, because no page stops for good: in five runs of `just perf-motion` on `main` 4d76dcaa with this
  change (the sway and 500 turns of the loop), no page stopped painting, none was loaded again and
  the desk never started again, where with the full pipeline the desk's page stopped in every run.
  `sway-painting` is no longer a check that comes and goes (#248 had it under `sometimes`).
* Good, because what is left is counted: 94 to 125 catch-ups a run, almost all for a size (`size`), a
  few for a page that asked again (`asked`), one hide and show (`shown`) that brought back a page
  the tellings had not.
* Bad, because a press paints later than with the full pipeline (below): RT-16's 16 ms still holds
  for the median composed frame on a busy desk, but not at p95 and not on a desk at rest. The
  budgets hold the measured values with a margin, and regaining 16 ms is a follow-up under #249 ("a
  press paints within RT-16 again without Chromium's full pipeline").
* Bad, because the catch-up works around CEF's resize hold and a page's stop rather than ending
  them: each is a telling on a timer, and a hidden and shown page fires `visibilitychange` twice.
* Neutral: `--disable-threaded-animation` (ADR 0165) stays: nothing measured animations on the
  compositor's thread again without the full pipeline.

## More Information

The reference Mac (Apple M4 Max, macOS 26), CEF 156 (branch 8078); load averages as given, as other
work shared the machine.

The full pipeline's place, the surface probe's presses (`just perf-compositor`'s), prompts from the
press, a load average of 2 to 6:

| full pipeline in | a press to its paint, p95 (median) | a press on a desk at rest, p95 |
| --- | --- | --- |
| every process (ADR 0157) | 7.40 and 7.38 ms (5.02, 4.78) | 16.30 and 17.17 ms |
| renderers only | 23.84 (17.92) | 34.70 |
| none | 22.79 (19.86) | 31.85 |

The loop, three runs each, before the stall watch told a page first:

| full pipeline, catch-up | the desk's page | plugin pages |
| --- | --- | --- |
| every process, off (`main`) | stopped in 3 of 3 runs, turns 24 to 27; the desk started again | |
| every process, on | stopped in 3 of 3 runs, turns 30 to 33; the desk started again | |
| renderers only, on | never stopped | stopped in 2 of 3 runs |
| none, on | never stopped | none, one and five loaded again |

Without the full pipeline, the stall watch telling a page at its asks: three runs on `main` 7ea7d5ce
(a load average of 4 to 9), one plugin page loaded again (run 2: five tellings, no paint); with the
hide and show at its last ask, five runs on `main` 4d76dcaa (a load average of 6 to 40): no page
stopped, none loaded again, no restart, in the sway and the loop alike (`just perf-motion --runs 5`:
every check passes but the known `sway-smooth` #249, `sway-sizes` and `sway-scene` #252, and
`sway-own-pixels` #252 at times).

`just perf-compositor` on `main` 4d76dcaa with this change (a load average of 10 to 40): a press to its
paint 18.02 ms at p95 (median 7.42), its composed frame 13.28 at the median, a caught press's wait
1.95, a press on a desk at rest 29.28 at p95 (its blocks 29.28, 28.53, 34.30); the desk at rest, the
desk's start and memory per surface within their budgets. The compositor's own start to its first
frame (`composeStartup`, `crates/desk-compositor`, which this change does not touch) read 38.1 ms
against 34.1 at that load.
