---
status: accepted
date: 2026-11-14
decision-makers: Team endue
---

Supersedes ADR 0157's choice of Chromium's full pipeline (its slower clock for long-idle surfaces and
its prompt frames stay). Amends ADR 0159, ADR 0162 and ADR 0165 where they hold a press to RT-16's
16 ms: the measured budgets below hold it instead, and 16 ms stays the target (#268, under #249).

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
* **A press's first frame** (`web_host/frames.rs`, `frames_pacing.rs`, `PROMPT_AFTER`): without the
  full pipeline, a begin frame the display gets before the page has handled the press is held to its
  deadline, a desk frame on, and CEF sends none meanwhile, so a press's prompts from the press on (ADR
  0157's) lose that frame. They now start 2 ms after the press, and the pressed surface takes no desk
  frame before them: the clock looks at a press at once, and on a desk at rest that look is a desk
  frame, whose begin frame went out with the press and was held. The surface probe without the full
  pipeline, its prompts' first delay set by hand (a load average of 3 to 25): a press beside two
  animating surfaces (`perf_input_to_paint`, the median of four to six runs a delay) painted 18.2 ms
  after it at the median with its prompts from the press, 6.4 at 1 ms, 7.1 at 2, 7.9 at 3 and 9.5 to
  11.8 at 4 to 6; at p95 22.5, 21.3, 18.3, 19.3 and 18.7 to 20.0 (each run's p95 is its second slowest
  of twenty, so runs at one delay spread 4 to 8 ms); the desk's frame holding it, at the median, 23.2,
  15.7, 14.5, 15.7 and 17 to 18. A press on a desk at rest (`perf_input_from_rest`) on a quiet machine
  read 34.8 to 35.4 ms at p95 in eight runs with the desk frame at the press, and 21.3 to 25.9 in
  thirteen without it on `main` 9eabfa87, 13.1 to 24.3 in eleven on `main` 858309f2 (#263 in); with
  the full pipeline 13.6 to 16.3 in three runs between those eleven, and 21.7 to 24.7 in eight quieter
  runs of `main` before this change. A first prompt 4, 6 or 8 ms after a press at rest painted later,
  not sooner (the median 23.7 to 25.3, against 11.3 to 16.9 at 2 ms): a page at rest that misses the
  first prompt's frame paints about 25 ms after the press whenever the prompt comes. This change first
  waited 16 ms on a surface at rest; the probe's press is a down and an up at once, and the up, heard
  on a surface no longer at rest, started the prompts 2 ms after it, so the gate never measured that
  wait. It is gone.
* **The budgets** (`e2e/perf/budgets.json`): set on a quiet machine (a load average under 6 at each
  run's start), from eleven runs on `main` 858309f2 with this change (five of `just perf-compositor`,
  six of its press probes alone), each the slowest plus 10 %, rounded up to the half millisecond;
  eighteen runs on `main` 9eabfa87 fall within them too. A press to its paint, p95: 22.5 ms (15.6 to
  20.4; 15.1 to 20.9 on 9eabfa87). A caught press's wait after CEF's busy-wait (ADR 0159): 8 ms (0.38
  to 7.26; 0.01 to 6.86): a caught press paints 10 to 20 ms after it on a quiet machine, in the
  busy-wait's 10 ms or up to 7 ms after it, and a run's median of five moves with that. A press on a
  desk at rest, p95: 27 ms (13.1 to 24.3; 21.3 to 25.9). The composed frame's median keeps RT-16's
  16 ms and fails in some runs: without the full pipeline a run reads about 13 to 17 ms or about 24 to
  27, a few between, on every commit measured (More Information), and what decides which is #268's
  first target.
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

* Good, because no page stops for good: in five runs of `just perf-motion` on `main` 4d76dcaa with
  this change (the sway and 500 turns of the loop) no page stopped painting, none was loaded again and
  the desk never started again, where with the full pipeline the desk's page stopped in every run. In
  ten more on `main` 858309f2 with the press's wait for its first prompt, the stall watch caught one
  terminal page once, in the loop at a load average of 14, and nothing else. `sway-painting` is no
  longer a check that comes and goes (#248 had it under `sometimes`).
* Good, because what is left is counted: 94 to 125 catch-ups a run, almost all for a size (`size`), a
  few for a page that asked again (`asked`), one hide and show (`shown`) that brought back a page
  the tellings had not.
* Bad, because a press paints later than with the full pipeline (below): on a quiet machine a press
  beside animating surfaces paints 15 to 21 ms after it at p95, against 6.6 to 10.7 with it, and
  RT-16's 16 ms is met at the median, not at p95. A press on a desk at rest paints 13.1 to 24.3 ms
  after it at p95 on `main` 858309f2, where the full pipeline beside it read 13.6 to 16.3: a page at
  rest that misses a press's first begin frame paints about 25 ms after the press. The budgets hold
  the measured values with a margin, and regaining 16 ms is #268 ("a press paints within RT-16 again
  without Chromium's full pipeline"), under #249.
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
`sway-own-pixels` #252 at times). On `main` 858309f2 (#263 in) with the press's wait for its first
prompt, ten runs in two batches at a load average of 4.5 to 15.9: no page stopped in the shake or the
sway and no restart; in the loop the stall watch caught one terminal page once, at a load average of
14; one run's desk was ended from outside mid-sway (no restart, no crash report, nothing in its log);
`sway-fps` read 52.4 to 57.6, under its 55 only at a load average of 14 and 16 (58.4 with the full
pipeline on 6e75d95e).

`just perf-compositor` and its two press probes alone on a quiet machine (a load average under 6 at
each run's start), the reference Mac; ranges over the runs, each run's p95 its second slowest press;
`main` with the full pipeline as the coordinator measured it the same day:

| | a press to its paint, p95 | its composed frame, median | a press on a desk at rest, p95 |
| --- | --- | --- | --- |
| full pipeline: `main` 6e75d95e, 4d76dcaa and 9eabfa87 (eight runs, a load average of 3 to 5) | 6.6 to 10.7 ms | 13.2 to 17.6 | 21.7 to 24.7 |
| none, the desk frame at the press (#248 as first merged, 0b1b46ac) | 16.5 to 24.7 (5 runs) | 14.2 to 27.0 (6 runs) | 34.8 to 35.4 (15 runs) |
| none, no desk frame before the first prompt, on `main` 9eabfa87 | 15.1 to 20.9 (18 runs) | 13.0 to 27.1 | 21.3 to 25.9 (13 runs; 9.7 once, warm) |
| the same on `main` 858309f2 (#263 in) | 15.6 to 20.4 (11 runs) | 15.7 to 27.2 | 13.1 to 24.3 (11 runs) |
| full pipeline on `main` 858309f2, between the last six of those (3 runs, a load average of 3 to 7) | 6.6 to 8.0 | 13.4 to 15.4 | 13.6 to 16.3 |

Without the full pipeline the composed frame's median reads about 13 to 17 ms in a run or about 24 to
27, a few runs between, on every commit measured (with it, 13.2 to 17.6 in eleven runs). Within a run
each press's composed frame comes a nearly constant time after its paint (2 to 6 ms in one run, 14 to
16 in another): the probe's presses keep their phase against the desk's 60 Hz frames from the run's
start, and in a late run a paint just misses the frame that would show it. One or two runs a commit
cannot tell those commits apart: 14.21 on 0b1b46ac and 26.65 on 858309f2 in the coordinator's runs;
27.01 with 0b1b46ac's change, 13.0 to 27.1 with this change on 9eabfa87 and 15.7 to 27.2 on 858309f2
in mine. The budget keeps RT-16's 16 ms; what decides the phase is #268's first target.

A press on a desk at rest is read in three blocks of twelve presses, and the gate takes the block
whose p95 is the median. Without the full pipeline a block reads about 13 to 17 ms or about 21 to 25:
on 9eabfa87 most read about 25; on 858309f2, 14 of 33 did, so a run's median block read 20.5 or more
in three of eleven runs. The full pipeline's nine blocks between them read 13.1 to 18.4.

With these budgets, five runs of `just perf-compositor` in a row on `main` 858309f2 at a load average
under 6 passed every check but the composed frame's median in its late runs (a press to its paint
15.6 to 20.2 ms at p95, its composed frame 15.7 to 27.2 at the median, a caught press's wait 0.38 to
2.15, a press on a desk at rest 16.45 to 17.09). The rest of `just perf-compositor` is not this
change's: the desk's start read 250.2 ms at its slowest once in eight runs on 9eabfa87, against 234.4
(`surfaceStartup`, a load average of 11.6 at that run's end), and 296 in one more run that another
gate's run beside it took to a load average of 16; every other value was within its budget or
baseline. Earlier, at a load average of 10 to 40, the compositor's own start to its first frame
(`composeStartup`, `crates/desk-compositor`) read 38.1 ms against 34.1.
