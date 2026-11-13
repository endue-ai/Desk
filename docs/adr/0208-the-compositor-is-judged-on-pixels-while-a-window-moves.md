---
status: accepted
date: 2026-11-14
decision-makers: Team endue
---

Status: amended by ADR 0213: the gate's main scenario grows and shrinks the app window on a sine while
a window inside it shakes, and judges the pictures' sizes, the windows once the app window rests and
the desk's own page too; a failure that comes and goes on `main` is listed under `sometimes`.

Carries out ADR 0205's rule (a change to the compositor, `desk-wm` or the off-screen host keeps the
motion gate green). Numbered past ADR 0206 and ADR 0207, which other open pull requests hold.

# The compositor is judged on pixels while a window moves

## Context and Problem Statement

The compositor's bugs kept coming back (tearing, trails, stalls, blur, focus) because every test
judged state at rest: a rect from `desk.windows.list`, a frame captured after the glide ended. On
2026-11-13 an unmerged frame trace and a shake on `main` 4e140552 found what no test had: 39.7 frames
a second in the development build, one optimized frame in four with another window's pixels, the
desk's page stopping in two runs of five, a window dropped at a fractional place 24 % softer. ADR
0205 makes a gate of that measurement and judges the quality track (#248 to #252) by it. What does
the gate run, what does it judge, and how does it run anywhere an agent works: a locked screen, no
pointer or keyboard, a person using the same Mac?

## Decision Drivers

* Judged on rendered pixels while a window moves, not on state at rest
* No screen, pointer or keyboard of the machine's: agents run it at night under a locked screen
* The person's real pointer cannot move what is measured
* Fails on what a person sees: dropped frames, another window's pixels, a frozen page, blur
* Fixed limits with the reason for each, no millisecond threshold without a measurement (ADR 0205)
* A known failure stays visible until its fix lands, and the fix must say so

## Considered Options

* A frame trace and a shake in the shell, judged by a script on the optimized build, headless
* A WebdriverIO spec in the app e2e (`just test-app-e2e`), on the debug build like every other spec
* Screen recordings of the real window, compared frame by frame
* A Rust test in `desk-shell` driving the compositor without CEF

## Decision Outcome

Chosen option: "a frame trace and a shake in the shell, judged by a script", because it measures the
app as shipped (CEF's pages, the web host, `desk-wm`, the compositor) at the optimized build's speed,
reads back exactly the frames it judges, and needs nothing of the machine's but a GPU.

* **The trace** (`apps/desk/shell/src/frame_trace.rs`, `DESK_FRAME_TRACE=<file>`): one JSON line per
  event, appended, so a desk that starts again (ADR 0202) writes on after a second `start`. A frame
  with its scene, image and render times; each laid-out scene with every window's place and whether it
  is drawn from its own page (ADR 0201) or from parts of the desk's; each surface's paint copied; each
  read-back; each page the #157 watch found stalled or replaced. Without the variable nothing is
  written and the hooks cost a branch.
* **The shake** (`compositor_window/motion.rs`, `compositor_input { shake }`, development commands
  only): a press on a window's title bar, the pointer swung on a sine from a thread of its own (2 Hz,
  ±200 px, a move every 8 ms), each move arriving through the event loop as an OS event does, then a
  release; it reads the frame back at rest, at moments of the swing and after the release. The OS's
  pointer is masked meanwhile, so a hand on the real mouse moves nothing measured.
* **Headless** (`DESK_COMPOSITOR_HEADLESS=1`): a traced headless desk renders each composed frame off
  screen, the window's size, one frame in flight as a swapchain keeps one or two, and ignores the OS's
  occlusion: it measures under a locked screen or behind other windows, and its frames follow the
  desk's own clock, not the display's. `--screen` presents to the window instead (for #249, which moves
  frames to the display's clock); its run fails when a frame was not presented.
* **The gate** (`just perf-motion`, `e2e/perf/motion.ts`, limits in `e2e/perf/motion.json`): the
  optimized shell with its development commands on, a fresh desk on the Default profile's 13 plugin
  windows at 1280×800, the Plugins window shaken once the desk's page has rested (no paint for 1.5 s;
  shaken during the desk's start, which paints 60 times a second, the same build measured 43 to 54
  frames a second on a busy machine); per run a timed shake and a captured one, three runs, the worst
  of them judged. It fails on:
  1. fewer than 55 frames a second while the window moves (60 is the desk's clock);
  2. intervals over 25 ms, a missed 60 Hz frame and a half, beyond 2 % of them;
  3. any mid-motion frame where the window shows pixels not its own: its rectangle, where the trace
     says the frame drew it, against its own pixels at rest, in blocks of 8 device pixels whose mean
     moves by more than 24 of 255, in 4 blocks or more. A window drawn half a pixel off moves a block
     by 12 at most; one pixel off, 3 blocks; two pixels off, 14; another window, 67;
  4. any page that stops painting: each page in sight touched over DevTools (two pixels, all but
     clear) must paint within 1.5 s, none found stalled or replaced, the desk not restarted;
  5. a window at rest after a drop at (+0.4, +0.6) softer than 0.95 of its sharpness at a whole pixel.
     It fails today (0.77) and is listed as known for #250: reported, not failed, and once it passes the
     gate fails until #250 takes it out of the list.
* **The development build** (`--debug`) is measured for the record and never fails: its speed is not
  what ships.
* **The baseline** on `main` 9dfca4dc is recorded in `e2e/perf/motion.json` and `docs/qa/TESTING.md`,
  which also says which changes run the gate. The worst of three runs, optimized and headless: 59.8
  frames a second, 0.4 % of intervals over 25 ms (p95 20.3 ms), no frame of 30 with pixels not the
  window's, no page stopped, 0.77 sharp at rest; presented to the window, 59.9 and 0.8 %. ADR 0201's
  own pages took the foreign frames from one in four to none. The development build ran as fast (59.7)
  and once found the Terminal's page stalled 3.5 s after the start, before any shake: the painting check
  counts a page that stops at any time of the run, not only in motion. Three runs take 99 s once built,
  on a machine at a load average of 14 to 36.

### Consequences

* Good, because a regression in what a person sees while dragging fails before it lands, and each of
  #248 to #252 shows its effect on the same numbers
* Good, because it runs where agents run: a locked screen, no devices, a person at the same Mac
* Good, because the trace says why a frame failed (which texture a window was drawn from, which
  surface stopped), not only that it did
* Bad, because headless frames follow the desk's clock and not the display's: what presenting costs
  (an image waited for, the compositor's vsync) is measured only with `--screen` on an unlocked screen
* Bad, because it samples frames (ten read back a run, thirty a gate) rather than every frame; a fault
  in fewer than one frame in ten can pass a run
* Bad, because it is a manual gate on macOS (about two minutes once built), not a CI job: no runner has
  a GPU and CEF's off-screen path yet (#61)
* Bad, because the shake drives one window of one layout; resizes, glides and the spread are not shaken
  yet
