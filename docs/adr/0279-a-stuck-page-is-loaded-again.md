---
status: proposed
date: 2026-11-21
decision-makers: Team endue
---

Follows ADR 0210 (a page caught up after a resize, and loaded again by the stall watch when nothing
else brings it back) and ADR 0208 (the motion gate's checks that come and go).

# A stuck page is loaded again, and the resize loop's stall is a check that comes and goes

## Context and Problem Statement

#345 asked why the motion gate's resize loop (100 turns: the app window grown and shrunk by four sizes
at once, a plugin window maximized or restored, a turn every 100 ms) stalls a plugin's page now and
then, "main.endue-terminal stalled (#157 watch)" first. The premise, a Terminal change, did not hold:
any page stops (Docker, Calendar, Eris, Local models, Projects, API Studio, Git Studio, Notes,
Database and Toolbar did here), in about one loop of ten. A stall fails the gate's `loop` check: the
stall watch (`stall.rs`, #157) found the page asking for frames through begin frames for three
seconds, painting nothing, and loaded it again. Is there a step the shell can take before that reload
that brings such a page back, or a way to keep it from stopping?

## Decision Drivers

* No page loaded again in the loop, and no check loosened without a reason measured (ADR 0208)
* No patch to CEF or Chromium, and no new millisecond threshold without a measurement here
* What the shell cannot cure is said plainly, with what was tried

## Considered Options

* A step of the shell's own before the reload (fifteen tried, below)
* Keep the page from stopping: tell CEF a hide only after a second; keep a page with a size in flight
  shown to CEF; keep every plugin window live (no sleep); the catch-up off
* Keep the reload, and list `loop` under `sometimes` in `e2e/perf/motion.json` with #345

## Decision Outcome

Proposed: "keep the reload, and list `loop` under `sometimes` with #345", because nothing the shell
can call brings such a page back, and none of the four changes lowered the rate it stops at. The
listing is the maintainers' to make: this change makes no code or gate change.

* **What a stuck page is.** Two Chromium traces of the whole desk (`viz`, `cc`, `cef`, `mojom`)
  around stalls of the Local models page, 2026-11-21. The view's display got no external begin frame
  from CEF after a given one, ever, while the desk's clock called `SendExternalBeginFrame` for it
  (80 times in the stall watch's three seconds) and its page asked. Its renderer kept asking for begin
  frames (`observing_begin_frame_source`, `needs_begin_main_frame`), its last one 13.7 s old; the
  view's root compositor committed nothing more. CEF 156 sends no begin frame while one is out
  (`begin_frame_pending_`, cleared only by the display's answer) and has no call that clears it or
  makes the view's compositor anew; a load brings the page back at once, in a new renderer. In the
  trace that holds the start, the page had been hidden (`WasHidden`) 11 ms after the begin frame of
  a new size, and the GPU process dropped the frame its renderer sent for it ("Submit rejected to
  evicted surface"): the hide had evicted its surface. Stalls also came with no hide from CEF before
  them.
* **Two kinds.** A page stuck with its last paint at its size, to a pixel, comes back when its
  browser hears its screen again (`catch_up::tell`): 5 of 5 such pages, at once. The stall watch's
  `asked` step does that a second in, so these show a wrong picture for a second and fail no check. A
  page stuck off its size (3 of 3, its last paint 3 to 62 px from it) comes back only when loaded
  again: those are the gate's stalls.
* **The steps tried**, on such a page with the stall watch held, each followed by a
  `requestAnimationFrame` of the page's own: a begin frame; its screen and size again, twice; a hide
  and show at once (`shown_again`) and a second apart; an invalidate; a new frame rate; a move or
  resize started; the focus; a device metrics override at its own size, and its clearing; a new scale
  and back; a size a pixel wider and back. None brought an off-size page back. Loading it again did,
  at once, every time.

### Measurements

The loop alone (`runLoop` and `analyzeLoop` of `e2e/perf/motion-loop.ts`, the Terminal snapped right
first), three desks of ten loops an arm, two arms at a time on the reference Mac at a load of 15 to
80, optimized development bundles of `main` a6a50ba9 with a scratch switch each. Loops in which a
page stopped:

| Arm | Loops stopped |
| --- | --- |
| `main` (four runs) | 5, 2, 2 and 4 of 30: 13 of 120 |
| A hide reaches CEF only a second (`LONG_IDLE`) after the surface was hidden | 2 of 30 |
| A view whose page has a size in flight is not hidden from CEF | 3 of 30 |
| Every plugin window kept live (`desk.surfaces.live` 40: no sleep) | 2 of 30 |
| The catch-up off (`DESK_CATCH_UP=off`) | 2 of 30 |

None is a change from `main` at this count. In the loop each turn hides and shows about five pages
(5,175 hides a desk in ten loops) and some pages sleep and wake: with every window kept live, the
Docker page loaded about 25 times less often, and stalls came as often. With a second's wait, under
2 % of hides reached CEF, and stalls came as often too.

### Consequences

* Good, because the gate stops failing for a stall the shell cannot cure, and the stall watch still
  brings every such page back within about three seconds, as before
* Good, because the next try starts from what a stuck page is, and from the steps that do not help
* Bad, because a page in the loop still shows a picture of the wrong size until it is loaded again,
  and a real stall in the loop is reported as known rather than failed while it is listed
* Neutral: the listing comes out with the fix that makes the loop pass in several runs (ADR 0208)

## More Information

Issue #345, its findings comments of 2026-11-16 and 2026-11-21 and this pull request. The scratch
switches, the remedy tries (`compositor_clock { try }`), the trace scripts and their outputs were
local to the investigation and are not committed. Not tried: a CEF or Chromium build of our own
(the only place `begin_frame_pending_` or the compositor's frame sink can be seen), and the full
pipeline again (ADR 0210 found the desk's page stopped in every run with it). Nothing is filed
upstream yet.
