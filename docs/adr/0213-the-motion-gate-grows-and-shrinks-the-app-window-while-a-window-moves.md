---
status: accepted
date: 2026-11-14
decision-makers: Team endue
---

Amends ADR 0208 (the motion gate): its main scenario grows and shrinks the app window while a window
inside it moves. Numbered past ADR 0210 to ADR 0212, which #248 and other open pull requests hold.

# The motion gate grows and shrinks the app window while a window moves

## Context and Problem Statement

ADR 0208's gate shakes one window inside a desk of fixed size, and it passes on `main` 6e75d95e. The
worst failure a person met on this desk came from the app window itself: on 2026-11-13 a live resize
stopped the desk's own page for good ("stopped painting ... through 167 begin frames (#157)"), and
programmatic resizes had never reproduced it. A person judges a window change by growing and
shrinking the app window quickly, over and over, while a window inside the desk moves. How does the
gate do that with no pointer of the machine's, and what does it judge?

## Decision Drivers

* The scenario a person's hands produce: the app window resized live and a drag inside it, at once
* No screen, pointer or keyboard of the machine's (ADR 0208)
* Judged on what a person sees mid-motion and once the app window rests
* No new millisecond threshold (ADR 0205): ADR 0208's limits carry over
* Today's failures stay visible with the issue that fixes them, also those that come and go

## Considered Options

* The app window's frame set on a sine from a thread, through the event loop, as
  `compositor_window { frame }` sets it
* AppKit's live resize for real: a synthetic drag of the window's corner (CGEvent) into its tracking
  loop
* Single resizes at intervals (the #248 probe's loop: four sizes a turn, 100 ms apart)

## Decision Outcome

Chosen option: "the frame on a sine through the event loop", because the shell does not treat a live
resize apart (below), so it takes the path a person's resize takes, at a hand's rhythm, without the
machine's pointer; a synthetic corner drag would move the real pointer and needs an unlocked screen.

* **What a live resize takes in the shell.** winit 0.30.13 reports AppKit's frame change as
  `Resized` from `frameDidChange:` (`NSViewFrameDidChangeNotification`), live or not;
  `windowWillStartLiveResize:` and `windowDidEndLiveResize:` only set resize increments, and the shell
  has no `inLiveResize` or `viewWillStartLiveResize` code. Either way `WindowEvent::Resized` reaches
  `CompositorWindow::resized` (`window.rs`), which resizes the GPU surface and the scene and tells the
  desk's page (`page_resized`) and the hosted surfaces (`rescale`). What differs: during a person's
  resize AppKit runs its tracking loop (`NSEventTrackingRunLoopMode`); winit's observers and the
  shell's timers are in the common modes, so frames and CEF's work go on, and `Resized` comes
  synchronously from the frame change rather than after the task that set it. The driver sets the
  frame from the event loop (`main_frame::set`: `setContentSize:`, then the origin): the same
  `Resized`, not the tracking loop.
* **The sway** (`compositor_window { sway }`, `compositor_window/motion.rs`, development commands
  only): the app window's frame on two sines around a middle, ±300 points wide over 700 ms and ±200
  high over 1000 ms (1.4 and 1 Hz), a new frame every 8 ms for 8 s, its top-left corner kept. The
  middle is the window's size, grown where the swing would take it under its least size (1024×500): a
  1280×800 desk sways from 1024×600 to 1624×1000. It ends half a swing past the middle (1474×900).
* **The scenario** (`e2e/perf/motion-sway.ts`, each run after ADR 0208's single shake): the Terminal
  window snapped to the right half (a fill follows the app window's size, ADR 0132, so its picture
  changes size with it; the canvas's windows keep their place and size); the Plugins window shaken as
  in ADR 0208 (2 Hz, ±200 px, a move every 8 ms) from 200 ms before the sway to 400 ms after it, read
  back ten times while both move, then dropped at (+0.4, +0.6); 1.5 s at rest, then dragged on 8 whole
  points as the sharp reference; then a poke and the stall watch's 4 s.
* **The trace** adds to each `win` line the size of each picture (each window's and the desk page's),
  the window's size and scale, the size the desk's page laid its scene out for (`Plan::screen`), and
  where the system layer lies over every window (its parts, edge bars, overlays, scrims and the map);
  and a `sway` line at the sway's start and end.
* **The checks**, `sway-` in the gate's table, the worst of three runs, against ADR 0208's limits:
  1. `sway-fps`: at least 55 frames a second while both move;
  2. `sway-smooth`: intervals over 25 ms at most 2 %;
  3. `sway-own-pixels`: no mid-motion frame where the shaken window shows pixels not its own, as ADR
     0208 judges them, leaving out where the system layer lies over it: its bars float over windows
     once the app window is short;
  4. `sway-sizes`: no frame where a window shows a picture laid out for another size than it is drawn
     at, cut or padded (`sampled` never stretches one);
  5. `sway-scene`: no frame where the desk's own page shows a picture laid out for another size than
     the scene drawn with it (its bars' boxes, its windows' places). Its picture trailing the app
     window's size is not counted, only recorded: a resize every 8 ms outruns any page, and the
     compositor draws that picture cropped or padded;
  6. `sway-painting`: no page that stops painting, the desk's own included, and no ADR 0202 restart,
     in the trace or in the log;
  7. `sway-settled`: once the app window rests, each window where the window manager put it, inside
     the app, drawn from its own page with a picture of its size, and the desk's page and scene at the
     app window's size;
  8. `sway-soft`: the shaken window, dropped at (+0.4, +0.6) after the sway, at least 0.95 as sharp as
     at a whole point.

  A run whose desk started again mid-sway is judged on what its first desk traced; what it never
  reached (the rest, the drop) counts from the other runs.
* **Failures that come and go** (`sometimes` in `e2e/perf/motion.json`): a check that fails in some
  runs on `main` and passes in others is reported with its issue, failed or passed, and does not fail
  the gate; its fix takes it out. `known` keeps ADR 0208's rule.
* **The baseline** on `main` 6e75d95e: see More Information and `docs/qa/TESTING.md`, which names
  the gate as the test for every change to how windows are placed, drawn, resized or painted.

### Consequences

* Good, because a window change is judged where it broke for a person: the app window resized while a
  window moves
* Good, because #248, #249 and #252 each show their effect on numbers the gate prints
* Bad, because it drives the event loop's `Resized`, not AppKit's tracking loop: a fault that lives
  only in that run-loop mode passes
* Bad, because the desk page's stall comes in some runs only, so one gate run does not prove #248
  fixed: its fix runs the gate more than once
* Bad, because a run takes about 50 s instead of 33

## More Information

### What the gate found on `main` 6e75d95e (macOS, M4 Max, headless at 1x, load average 3.7 to 4.3)

The worst of three runs (`just perf-motion record`, `e2e/perf/motion.json`):

| check | value | verdict |
| --- | --- | --- |
| frames a second while both move | 58.4 | pass |
| intervals over 25 ms | 10.7 % (p95 28 ms, max 49.9 ms) | known, #249 |
| frames where the shaken window shows pixels not its own | 2 of 30 | at times, #252 |
| frames where a window's picture is laid out for another size | 1148 of 1408 (82 %) | known, #252 |
| frames where the desk's page is laid out for another size than its scene | 670 of 1408 (48 %) | known, #252 |
| pages that stopped painting | the desk's own in run 3, then an ADR 0202 restart | at times, #248 |
| windows off their place or the app once it rests | none (runs 1 and 2) | pass |
| sharpness at rest after the sway | 0.99 | pass |

* **The long intervals** come from outside the frame: a frame's own work stays short (p95 3.5 ms,
  its scene 2 ms), while the main thread also resizes the GPU surface, tells CEF and imports about
  200 paints a second for each resize. #249 moves drawing to a render thread on the display's clock.
* **The pictures of another size** are the snapped Terminal's: its frame takes each new size at once
  and its page paints it later, so its old picture is drawn cut (three frames in four) or padded (one
  in four) in 82 % of the frames. #252 (open as #263) keeps a window's frame at its picture's size until
  a picture of the new size comes.
* **The desk's page against its scene**: its report (where windows go, its bars' boxes) and its
  picture reach the compositor apart, so in half the frames the bars' pixels are drawn where the
  scene no longer has them. The two foreign frames are of this kind: the dock and Eris's pill drawn
  over the shaken window, outside the boxes the scene had for them. #252 is named for it; its fix must
  cover the desk's own page as well as windows, or a task of its own takes the check over.
* **The stall** came in 3 of 10 sways on 2026-11-14 (in the run above, on the first try of a 5 s sway
  without the snapped window, and in one run of an earlier record): the desk's page painted last 2.8
  to 5.8 s into the sway, and 3 s later the stall watch logged the line the person's desk logged on
  2026-11-13 (there after 167 begin frames): "the desk's page stopped painting: its page waited 3.0 s
  for a frame through 176 begin frames (#157)", then "starting a new desk ... (ADR 0202)". #248's
  probe found why
  (the full pipeline's display waits for root damage with no deadline after a resize, and CEF sends no
  begin frame while one is out); the sway reproduces what single resizes had not.
* **What did not fail**: the windows on the canvas keep their place and size while the app window
  changes (ADR 0082's canvas; only fills follow it), every one of them was at its place with a picture
  of its size once the app window rested, and the shaken window was as sharp after the sway as at a
  whole point. The single shake still passes alongside (59.6 frames a second, 1.7 % long intervals).
* A run takes about 50 s, three take 153 s once built. The development build and the window-presented
  variant keep #247's baselines; neither has run the sway (the presented one would resize a window on
  the person's screen).
