---
status: accepted
date: 2026-11-15
decision-makers: Team endue
---

Amends ADR 0210 (what held a press was a begin frame sent before it, and a press beside animating
surfaces is held to RT-16's 16 ms again), ADR 0157 and ADR 0164 (input no longer puts a surface on
every desk frame for a second; a page asks at once when its frames have stopped). ADR 0162 stands: a
press on a desk at rest waits for the GPU to wake.

# Input brings a surface the next desk frame, not a second of them

## Context and Problem Statement

Without Chromium's full pipeline (ADR 0210) a press beside animating surfaces painted 15.6 to
20.4 ms after it at p95, where RT-16 asks for 16, and its composed frame's median read about 13 to
17 ms in one run and about 24 to 27 in the next. ADR 0210 put the press's wait down to a begin frame
that reaches the display before the page has handled the press, and started a press's prompts 2 ms
after it. #268 asks what decides a run's phase and for 16 ms again, the full pipeline staying off.

The surface probe's presses were traced on `main` b30d0628: a frame trace line for each press, begin
frame, paint and composed frame, and Chromium's own trace (`DESK_PROBE_TRACE`).

* **Beside animating surfaces** the page had handled every press 0.3 to 2.1 ms after it, before
  the first prompt. The paint did not follow the prompt: it came about 4 ms after the web host's
  next desk frame. The pressed surface had heard input within the second, so it took every desk
  frame, and the begin frame of the desk frame before the press, sent to a page with nothing to
  draw, was out: Chromium's display held it to its deadline, 16.7 ms after it was sent (`No damage
  yet`, the late deadline), and CEF sent none of the prompts meanwhile. A press waited out what was
  left of that hold, anything from nothing to a frame, and painted about 4 ms later: 4 to 21 ms,
  16 to 20 at p95. The probe's presses, 150 to 166 ms apart and each painted, also read as painting
  (two paints within 250 ms), which keeps a surface on every desk frame by itself.
* **The phase.** So a press's paint came a fixed time after the web host's desk frame, whenever the
  press was. The probe's desk composes on a 60 Hz clock of its own, a fixed time from the web host's
  for the whole run: each paint came 2 to 6 ms before the frame that showed it in one run and 14 to
  16 in another.
* **On a desk at rest** no begin frame was missed. In the three presses read in Chromium's trace
  (one fast, one slow, one of the slowest) the page had handled the press by 0.5 to 1.9 ms, the
  first prompt went out at 2.2 to 2.6, the display drew the page's frame at 3.2 to 4.3 and the
  capture's copy was issued at 3.5 to 5.9. Then viz looked for the copy's end every 2.3 ms and found
  it 8.1, 14.5 and 18.0 ms after the press. The desk's own wake-up copy (ADR 0162: 64 by 64 pixels,
  submitted 0.1 to 2.4 ms after the press) finished 2.9 to 14.8 ms after the press in 37 presses of
  one run, and the press's paint came 1.9 to 7.2 ms after it in 34 of them. That is ADR 0162's
  finding again: the GPU's wake-up, which starts at the press. The slower mode ADR 0210 saw (21 to
  25 ms) is the probe's own, and the other three presses': its desk composes a frame 16.7 ms after
  a press at rest, that compose waited 8 to 9 ms for the cold GPU with CEF's work behind it (the
  capture ended at 18.1 ms, the paint was handed over at 26.1), so a paint that was due after
  16.7 ms comes at about 25.

How does a press paint within 16 ms without the full pipeline, with every page still painting what
it changes?

## Decision Drivers

* A press to its paint within RT-16's 16 ms at p95, the full pipeline off (ADR 0210)
* A change nobody announces (a transition a hover starts, a caret) still shows
* No page that stops painting, no ADR 0202 restart (`just perf-motion`)
* A desk at rest costs no more (ADR 0164)
* No patch to CEF or Chromium

## Considered Options

* Input brings the next desk frame, the two after a paint and the slow frames; a page asks at once
  when its frames have stopped, and that ask is a press's first prompt
* Every desk frame for a second after input, as before, and end the begin frame that is out when a
  press comes: CEF sends no begin frame while one is out and clears that only when the display
  answers; an `Invalidate` would end it with a second capture of the same picture, which the desk
  would take for the press's paint (not tried)
* No begin frame without a reason at all (no slow frames after input): a change the page cannot
  announce and that starts later than the input's own frame (a transition with a delay) would wait
  for the next input
* A press's first prompt from the page's tell alone (#268's first idea), the desk frames as before:
  the page had handled the press before the prompt in every traced press; the begin frame out
  before the press is what it waited for
* Keep the GPU awake at rest: ADR 0162 rejected it (work at rest for good)

## Decision Outcome

Chosen option: "input brings the next desk frame, the two after a paint and the slow frames",
because a begin frame sent to a page with nothing to draw costs whatever comes within a frame of it,
so the desk sends one only where something may have changed; the slow frames keep what nobody
announces.

* **Input** (`web_host/frames_pacing.rs`, `Pacing::input`; `frames.rs`, `Heard::Input`): a move, a
  wheel, a press or a key brings its surface the next desk frame (a press its prompts, as before),
  and for a second the slow frames (ten a second, ADR 0185), counted from the last input: the
  input's own frame comes first. A stream of moves still takes every desk frame while it lasts.
  A message that is not input (a size, its screen, a load, shown again) wakes a surface onto every
  desk frame for a second as before: a page may need several frames for those and announces none.
* **After a paint** that followed input within a second, the surface takes the next two desk frames
  (`AFTER_PAINT`): a change that goes on by itself gets its second frame a desk frame after its
  first, and two paints within 250 ms put it on every frame (`PAINTING`). Two, as the first may
  find a press's last prompt still out.
* **A press's paint is not painting**: the paint a press waited for does not count towards
  `PAINTING`, however soon after the last paint it came. By the old rule typing a few keys a second
  kept a surface on every desk frame, as the probe's presses did.
* **A page asks at once** (`web_host/frame_asks.js`): a want that comes when no frame met one for
  40 ms (the script's wait) finds a page whose frames have stopped, and the page asks then instead
  of 40 ms later. A change a reply or a timer makes between the slow frames shows a desk frame on.
  It asks from the want itself, not from a timer: in a page handling input a timer of no delay ran
  after the prompt's frame had come, in every traced press.
* **The ask is a press's first prompt** (`Pacing::ask`): a page that changes for a press asks 0.3 to
  2.1 ms after it, and the begin frame goes out then. A page that changes by style alone (`:active`)
  asks nothing and keeps the prompt 2 ms after the press (`PROMPT_AFTER`, ADR 0210).
* **The probe** (`probe/input_gate.rs`): each of the twenty presses comes a twentieth of a desk
  frame later in the probe desk's frame than the one before, and within 200 ms of the last (below).
* **The budgets** (`e2e/perf/budgets.json`): a press to its paint, p95, within 16 ms again and a
  caught press's wait within 2 ms, as before ADR 0210. A press on a desk at rest keeps ADR 0210's
  27 ms: nothing here changes it.

### Consequences

* Good, because a press beside animating surfaces paints 3.8 to 8.7 ms after it at p95 in twelve
  runs (its median 3.1 to 6.0), where `main` beside them read 15.7 to 23.0 (5.2 to 12.6); no press
  of 240 took 16 ms, where 39 of 240 did. The full pipeline read 6.6 to 10.7 (ADR 0210).
* Good, because a run has no phase: the composed frame's median read 12.5 to 16.2 ms in those runs,
  where `main` read 14.1 to 27.6. It is the paint's median plus the wait for the desk's next frame
  (half a frame) and its compose, so it passes 16 ms while a press paints within about 5 ms at the
  median (once over in twelve runs, at 16.16 with the paint's median at 5.96).
* Good, because a page's own change on a desk at rest shows 9.6 to 17.8 ms after it in three runs
  (`deskAtRest.ownChangeMs`), where it showed after 49.6 to 51.6 (ADR 0164).
* Bad, because a slow frame's begin frame is still sent to a page that may have nothing to draw. A
  press 100 ms to a second after the last input finds one out one time in six and waits up to a
  frame. With the probe's last four presses 190 to 210 ms after the one before, eight runs
  at a load average of 11.6 to 19.6: 9 of 160 presses took more than 16 ms (21.0 at most), and the
  p95 read 19.9 and 20.9 ms in two runs (3.8 to 11.9 in six). The gate's presses come within 200 ms
  of each other, so it does not see this.
* Bad, because a press on a desk at rest is where it was: it waits for the GPU to wake (More
  Information). 16 ms at p95 there needs the GPU awake at the press, or Chromium's capture without
  the copy.
* Bad, because in the second after input a change nobody announces shows at the next slow frame, up
  to 100 ms on, where every desk frame showed it within 17 to 33 ms: a transition with a delay, or
  one a single move starts (its first frame changes no pixel, so no paint follows it; a pointer
  that goes on moving over the element brings the frames). Nothing here measures it.
* Neutral: a begin frame with nothing to draw still costs a frame. Ending it at once needs CEF to
  send a begin frame while one is out, or to say when a renderer wants one; with either the slow
  frames and the 2 ms prompt could go.

## More Information

The reference Mac (Apple M4 Max, macOS 26), CEF 156, `main` b30d0628; other agents built on the
machine, so each range has its load average. The surface probe's `input` run (`perf_input_to_paint`)
alone, the two builds turn by turn; each run's p95 is its second slowest of twenty presses.

| twelve runs each, a load average of 6.2 to 14.4 | a press to its paint, median | p95 | slowest | its composed frame, median | a caught press's wait |
| --- | --- | --- | --- | --- | --- |
| `main` b30d0628 | 5.2 to 12.6 ms | 15.7 to 23.0 | 17.3 to 23.6 | 14.1 to 27.6 | 0.0 to 8.3 |
| this change | 3.1 to 6.0 | 3.8 to 8.7 | 4.4 to 12.8 | 12.5 to 16.2 | 0.0 to 0.02 |

Step by step, the probe's presses as on `main` (150 to 166 ms apart), eight runs each turn by turn,
a load average of 7.5 to 27.5:

| | a press to its paint, median | p95 | its composed frame, median |
| --- | --- | --- | --- |
| `main` b30d0628 | 5.6 to 14.3 ms | 15.5 to 20.3 | 13.7 to 25.9 |
| input brings the next desk frame; a press's paint is not painting | 5.3 to 6.0 | 5.9 to 9.5 | 13.1 to 16.2 |
| and the page's ask is the first prompt | 3.5 to 4.8 | 4.4 to 10.3 | 12.0 to 16.0 |

Input off every desk frame alone, with the press's paint still counted as painting, left the p95 at
15.0 to 20.0 ms in six runs (a load average of 13.5 to 27.4): the probe's click surface stayed on
every desk frame.

A press on a desk at rest (`perf_input_from_rest`, three blocks of twelve presses after 2 to 3 s at
rest), the two builds turn by turn:

| | runs, load average | p95 of the run's median block | every block's p95 | the median block's median |
| --- | --- | --- | --- | --- |
| `main` b30d0628 | nine, 3.0 to 11.3 | 8.6 to 26.2 ms, over 16 in six | 8.4 to 26.5, over 16 in 16 of 27 | 8.1 to 23.3 |
| input brings the next desk frame (no ask at once yet) | four, 4.4 to 14.0 | 10.5 to 23.2, over 16 in one | 10.2 to 26.3, over 16 in 5 of 12 | 8.2 to 14.4 |
| this change | five, 3.1 to 14.0 | 6.6 to 20.6, over 16 in two | 6.6 to 24.6, over 16 in 7 of 15 | 6.3 to 16.2 |

The builds do not differ at rest beyond what the machine does from run to run: a quiet machine
wakes later (`main` read 23.3 ms at the median at a load average of 3.0). What a press at rest waits
for, in one traced run of 37 presses: the desk's wake-up copy finished 2.9 to 5.4 ms after the press
in 14 presses, 6.1 to 10.2 in 19 and 11.0 to 14.8 in four, and the press's paint 7.8 to 10.6, 10.8
to 16.5 and 13.8 to 26.2 ms after it. The page's ask now brings the first prompt before 2 ms, which
moves a press whose GPU woke soon (6.3 ms at the median in one run) and no other.

`just perf-compositor`, three runs in a row at a load average of 5.1 to 6.8 (a quieter machine,
whose cores wake later than in the runs above): every check passed in each. A press to its paint
9.58, 10.40 and 15.98 ms at p95 (4.7 to 5.6 at the median), its composed frame 14.2 to 15.3 at the
median, a caught press's wait 0.01, a press on a desk at rest 17.3, 24.2 and 25.3, a page's own
change at rest 9.6, 11.2 and 17.8, the desk at rest 10.3 to 10.4 wake-ups a second. The 15.98 is
two slow presses in one run: now and then a press takes 9 to 14 ms (12 of 520 in 26 runs of the
probe alone, a run's first and its last four times each; they were not traced), more often on a
quiet machine.

`just perf-motion --runs 5`, twice with this change and once with `main`'s shell sources in the same
tree. The shake and the sway were clean in all fifteen runs: no page stopped painting, the desk's
own included, and no desk started again (`sway-smooth` is #249's known failure). The loop was not,
with or without this change: the Terminal's page stayed at one size through the catch-up's
tellings until the stall watch loaded it again (ADR 0210's fault). The loop sends no input; of this
change only the page's earlier ask is at work in it. Three runs of ten against two of five does not
tell the builds apart.

| | load average at each run | the loop |
| --- | --- | --- |
| this change | 44.6, 49.2, 18.5, 9.1, 4.9 | run 3: the Terminal's page stalled |
| this change | 14.8, 14.5, 9.6, 26.7, 22.8 | runs 2 and 4: the Terminal's page stalled (twice in run 4) |
| `main` b30d0628's shell | 5.8, 4.8, 6.5, 4.7, 3.6 | runs 2 and 5: the Terminal's page stalled (in run 5 it also painted nothing when touched) |
