---
status: accepted
date: 2026-11-11
decision-makers: Team endue
---

# A resting surface takes no begin frames, and its page asks for them

## Context and Problem Statement

After ADR 0159 a desk at rest still woke about 35 times a second: ADR 0157's slow clock sent each
long-idle surface ten begin frames a second, and CEF's answers to them were most of those wake-ups.
And a fresh desk (its first run open, 22 plugin pages) held its browser process at about 55 % of a
core (#129). A desk with nothing changing should wake only for the OS and CEF's own due work: no
begin frame to a surface without damage or a pending request. But CEF says nothing of what a
renderer waits for: no callback for a page's own request, a timer's change or an animation it
starts (`CefRenderHandler` has none). How does a resting surface get no begin frames, and still
show a change of its own at once?

## Decision Drivers

* The probe's rest run: at most 15 wake-ups a second with three idle surfaces (`just perf-compositor`)
* A fresh desk with its first run gone through within 5 % of a core (`just perf-app`'s `rest.perf.ts`)
* A page's own change still shows, within 100 ms (ADR 0157 bounded it at its 100 ms period)
* No patch to CEF or Chromium (ADR 0157); what is a plugin's is reported, not hidden

## Considered Options

* No begin frames at rest, and the page asks: a script every frame's page runs looks whether a frame
  comes when something there may need one
* A slower clock (one begin frame every one or two seconds): fewer wake-ups, but begin frames with
  nothing pending, and a page's own change waits up to that period
* Coalesce CEF's answers (hold its work a few milliseconds after a look): its answers come in two
  waves a begin frame, so a look still costs two wake-ups

## Decision Outcome

Chosen option: "no begin frames at rest, and the page asks", because a resting desk then has
nothing on its clock, and a change shows within a frame of the page's asking.

* **The clock** (`web_host/frames.rs`): a surface that painted nothing and heard nothing for a
  second rests and takes no desk frame. Input and a compositor message for it wake it as before; a
  message to its page (`host::send`) no longer does by itself.
* **The ask** (`web_host/frame_asks.{rs,js}`, `renderer.rs`): before a frame's scripts run, its page
  gets a script that, when something there may need a frame (a `requestAnimationFrame`, a change to
  the document, `Element.animate`, media playing, a load, a font, a draw on a 2D, WebGL or WebGPU
  canvas), wants one: while a want is unmet (no frame came after it), a frame must come within
  40 ms, two desk frames, of it or of the last frame; if none does it calls `__deskNative.wake()`
  (the `desk.wake` process message), and again a second on while none came (an ask lost while its
  surface was hidden or the clock held). A want made in a frame after the frame met the earlier
  ones (a `requestAnimationFrame` loop's next frame) waits for a frame of its own, so a page waiting
  on a frame asks until one comes, wherever its frames stopped: a first version looked once per
  40 ms and missed the wants made during that look, and an animating page whose frames stopped
  inside it (the probe's held clock, about one run in two) waited for good. The clients tell the
  clock (`frames::asked`), which gives the surface the desk frames within 42 ms of its look; a
  paint they bring wakes it as any paint does.
* **What kept a fresh desk busy**, found with the processes' CPU and each page's task time over
  DevTools, Chromium's trace and `sample`: the first run's animation (its surface painted at every
  frame until it ends); Eris's idle motion, her mesh drawn on a canvas at every frame in the shell
  page and in her floating window (about 100 ms of script a second each); the runtime's ticker and
  the page's report (`compositor-desk.ts`), which asked for a frame at every frame; a message to a
  page, which woke every surface for a second at 60 Hz; and on a locked screen the compositor, whose
  window answers `Occluded` at once: it composed the desk at every desk frame and stayed dirty.
  Each is the desk's: the ticker asks for no frame once every tick says `IDLE`; Eris rests after
  ten seconds idle, silent and settled (her state, a line, a turn, a drag, a pointer or a new size
  wakes her); the report looks every frame only while the desk changes, then stops after 30 frames
  (a change to the page, a new size, the compositor's word or a look every second start it again);
  a withheld frame is composed once and asked for again after a second (`gpu.rs`). Once a page
  waiting on a frame kept asking, one more showed: the Eris plugin's page, whose timeline
  (`plugins/eris/ui/timeline.js`, the first run's too) asked for a frame at every frame with
  nothing on it, took about 35 begin frames a second and painted none. A timeline holding no
  animation and no cue asks for no frame now; its time stands still until a cue or an animation
  starts it again, and goes on from there.

### What the measures found (macOS, M4 Max)

* The rest run, before: 37.3 wake-ups a second, 29.6 begin frames, a page's own change painted
  107 ms after it. After, `just perf-compositor` five times at a load average of 5 to 8: 10.1 to 10.3
  wake-ups, no begin frame, the change painted 49.6 to 51.6 ms after it (a timer's, three a run).
* A fresh desk with its first run gone through, its own process: 59.2 % of a core before (its tree
  124.9 %), 3.1 to 3.4 % after in three runs at a load average of 5 to 9 (its tree 5.3 to 5.7 %).
  On 2026-11-11 the same head read 6.8 % (its tree 12.7 %) at a load average of 4 to 5, no surface
  taking a begin frame; after the ask's fix and Eris's timeline, 6.7 % (12 %), the same. With the
  ask's fix alone, 13.8 % and 14.0 %: Eris's page asking every 80 ms.

### Consequences

* Good, because a desk at rest wakes ten times a second (CEF's poll, ADR 0159) and sends no frame.
* Good, because what made a fresh desk busy is named, the desk's parts fixed, a plugin's reported.
* Bad, because the page's script is in every page: it wraps `requestAnimationFrame`,
  `Element.animate` and the canvases' drawing calls, and observes the document. A change none of
  those see (a scroll by script, a CSS animation's delayed start) waits for the next input or ask.
* Bad, because a page that asks for frames it does not use (a `requestAnimationFrame` loop that
  draws nothing) asks every 80 ms; its renderer pays, and the desk's wake-ups with it. A hidden
  page that keeps wanting frames asks once a second, for nothing.
* Bad, because Eris no longer breathes on a desk left alone for ten seconds.
* Bad, because the windowed panes (the palette, the floating Eris, the palette's frame) still take
  Chromium's 60 Hz begin frames with idle pages: about 60 of CEF's work calls a second. Chromium's,
  not the desk's clock. endue.docker's `proc.spawn` every two seconds is the plugin's.

## More Information

Issue #134 (epic #32 §8), found by #129. Amends ADR 0157 (the slow clock: none at rest) and ADR 0159
(what still wakes a desk at rest). Code: `apps/desk/shell/src/web_host/{frames,clock,frame_asks,
client}.rs`, `frame_asks.js`, `renderer.rs`, `client.rs`, `host.rs`, `compositor_window{,/clock,/gpu}.rs`,
`packages/runtime/src/shell/{ticker,Running}.ts`, `packages/runtime/src/eris/{Eris,figure,float-desk,
states}.ts`, `apps/desk/src/{compositor-desk,desk}.ts`, `plugins/eris/ui/timeline.js`,
`probe/{rest,pages}.rs`. Tests: `web_host/frames_tests.rs`, `web_host/frame_asks.test.ts`,
`shell/ticker.test.ts`, `eris/Eris.test.ts`, `plugins/eris/tests/timeline.test.ts`, `compositor-desk.test.ts`,
`tests/budgets.rs` through `just perf-compositor` (`deskAtRest`), `e2e/perf/rest.perf.ts` through
`just perf-app` (`freshDeskAtRest`). No section of `docs/ko/desk-structure.md` changes.
