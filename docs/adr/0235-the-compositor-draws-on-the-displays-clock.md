---
status: proposed
date: 2026-11-21
decision-makers: Team endue
---

Track 3 of ADR 0205's quality track (#232, #249). Refines the desk's frame clock (ADR 0152) and keeps
ADR 0164, 0185, 0200, 0231 and 0261.

# The compositor draws on the display's clock, from a render thread of its own

## Context and Problem Statement

The compositor window drew each frame in winit's `about_to_wait` on a fixed 16.667 ms beat
(`compositor_window/clock.rs`, `web_host/frames.rs` `FRAME`). That is the thread that also runs CEF's
message pump, the bridge and every texture import. A frame was late whenever that thread was busy
when the frame came due: CEF's work runs in 10 ms slices that busy-wait (#129), and a resize sends
the pages new sizes. The beat forgives a frame late by less than an interval (`Due::beat`), so a
frame late by more than half an interval was an interval over 25 ms.

The resize-loop traces of `main` a6a50ba9 (optimized, headless, load about 28, 3 runs; the #345
worktree's `target/loop-repro`) show where the time went. A frame's whole tick took 0.9 ms at the
median and 1.8 ms at p95: the layout 0.6 ms, the render 0.4 ms. Yet 7 to 10 % of the intervals
were over 25 ms, at p99 31 to 35 ms. The frames were late because the main thread was elsewhere,
not because drawing was slow. The motion gate's sway measured 13.4 % of its intervals over 25 ms
(p95 27.1 ms, max 42.3) that morning (`sway-smooth`, known for #249). A 120 Hz display got 60
frames a second.

## Decision Drivers

* Frames at the display's rate, 60 or 120 Hz with ProMotion
* A busy main thread costs no frame it has already laid out
* A frame never shows a picture at another size than the one its layout saw: a surface node samples
  its picture at that size (`draw::sampled`), and ADR 0227 and 0233 keep frame and content together
* Begin frames to surfaces keep their pacing (ADR 0164, 0185, 0200), and the desk at rest wakes no
  more than before (`just perf-app`)
* A key's paint at rest waits for no tick

## Considered Options

* The main thread lays out and hands a copy of the scene to a render thread. The render thread draws
  it behind its slot, by up to three quarters of an interval in a run of frames, and owns the
  swapchain
* The main thread lays out and the render thread draws at once on hand-off, at most one frame an
  interval
* The main thread keeps drawing, at the display's interval instead of a fixed 60 Hz
* A display link callback on its own thread that lays out and draws

## Decision Outcome

Chosen option: the render thread drawing each frame behind its slot. Only a frame drawn later than
it was laid out can absorb a late main thread. The layout needs about a millisecond, so a main
thread that comes to its layout up to most of an interval late still hands the scene over in time.
Drawing at once on hand-off would only move the 0.4 ms of rendering off the main thread. Drawing
at the display's interval on the main thread keeps every late frame late. A display link that lays
out would need the window manager, the router and CEF's pump off the main thread.

* **The display's rate** (`compositor_window/display.rs`). macOS reads
  `NSScreen.maximumFramesPerSecond` of the window's screen. Off screen (headless, the gates) it reads
  the main screen's, so the gate needs no screen. Other platforms keep 60 until they are measured
  (#61). The rate is read again on a resize, on showing and on focus.
  `web_host::frames::interval(rate)` is 16.667 ms at 60 Hz and 8.333 ms at 120 Hz.
* **The beat.** A frame is due a display interval after the last (`Due::frame`, `Due::beat`). The web
  host's clock counts desk frames at the same rate (`WebHost::set_display`), and each look hands that
  rate to every surface's pacing. A pace stays in frames a second, so a surface paced at 60 takes
  every other begin frame at 120 Hz. Its slow frames stay a tenth of a second apart. Surfaces keep
  their pace of 60 in front and 30 behind, so a 120 Hz display does not double what the pages
  paint. `FRAME` stays Chromium's own begin-frame interval, which the flight of a begin frame keeps
  (ADR 0261).
* **The render thread** (`compositor_window/render_thread.rs`, `frame.rs`). The main thread lays the
  scene out on the beat and hands a clone (`Scene` is `Clone` now, its id and revision with it), or
  `None` when only pictures changed. A frame from rest is drawn at once. In a run, each frame is
  drawn an eighth of an interval further behind its slot than the one before, up to three quarters
  of an interval (`clock::Behind`), so the cadence never jumps. A frame handed late is drawn at once.
  A scene handed for the slot of the one waiting replaces it; one for the next slot waits behind it,
  so a frame the render thread is late for is drawn, not dropped. The thread runs at
  user-interactive quality of service. It owns the swapchain, with the waits for an image the OS
  withholds or hands out late (`gpu::Swapchain`), and hands it back to the main thread when it
  stops (the swapchain holds winit's window, which goes on the main thread). Headless, it renders
  off screen while a frame trace runs, as the main thread did.
* **A picture of a new size goes to a texture of its own** (`compositor_window/composed_retired.rs`).
  A paint of another size than its surface's picture goes to a new texture, which is the picture
  at once, so the main thread sees the new size when it did before (the desk's page is laid out from
  the report its picture's size names). A paint of the picture's size is copied into it as it comes.
  A picture replaced (a new size, shown from aside, the desk page's report) or a surface gone
  retires: a scene handed before draws it still, and it is destroyed once the render thread drew a
  frame handed after it retired. The surface probe, which lays out and draws at once, keeps
  resizing in place.
* **The gate** (`e2e/perf`). The trace names the display (`display`). `minFps` is by rate: 58 at
  60 Hz, 110 at 120, and the nearest rate's share elsewhere. Intervals over 25 ms are allowed for
  at most 1 % (2 % before). A third shake holds the main thread 20 ms right after a frame, every
  250 ms (`compositor_input { busy }`, development builds), and `busy` fails on any frame dropped
  across a loop: an interval of a display interval and a half.

### Consequences

* Good, because a frame laid out is drawn on time whatever the main thread does next. That covers
  a CEF slice, a bridge call, an import, a capture or the busy loop
* Good, because a 120 Hz display gets 120 frames a second from the compositor, while the pages keep
  their 60
* Good, because a picture can no longer change size under a laid-out scene, on screen or in a capture
* Bad, because in a run of frames each one is shown up to three quarters of an interval later than
  before: 12.5 ms at 60 Hz, 6.25 ms at 120. A frame from rest (a key's paint) is not delayed
* Bad, because a texture replaced lives a frame longer (`retire`), a picture of a new size is a new
  texture where it was resized in place, and each frame copies its scene (a few hundred nodes)
* Bad, because the frame trace's `acquireMs` now includes the wait behind the slot, so `tickMs`
  spans the layout to the draw on another thread
* Bad, because the canvas map's icons swept by a layout (ADR 0273) are not retired. A frame still
  waiting draws the map without such an icon if the render thread is late past the next layout

## More Information

A first cut (a32bba8e) held a paint of a new size back until the next layout, and dropped a waiting
frame when the next came. Measured back to back with `main` 1f206027 (load 20 to 30), the shake ran
43 frames a second: the render thread woke 1 to 5 ms late, and the next frame replaced the one
waiting. `sway-scene` failed on 1249 frames of 1387: the desk's page is laid out from the report
its picture's size names, read before the layout showed the new size. Both are what the decisions
above replace. `sway-smooth` was 4.6 % against `main`'s 12.8 %.

Issue #249; `docs/ko/desk-structure.md`'s compositor section describes the frame on the main
thread and should name the render thread once this is accepted.

On screen the render thread keeps the beat of the main thread's clock. The swapchain's FIFO
present aligns it with vsync, and no display link drives it yet (`CADisplayLink` from the window's
view is the next step, if `--screen` shows the beat drifting against the display's).

Measured on 97024585 (optimized, headless, the reference Mac mini, 2026-11-21), five runs at a
load of 3.1 to 7.3. `fps` was 59.6 and `busy` dropped 0 frames in 80 busy loops. `smooth` was 0 %
(p95 21.2 ms, max 24.6). `sway-fps` was 59.5 and `sway-smooth` 0.8 % (p95 21.4 ms, max 44.4), out
of `known` since. No mid-motion frame showed pixels not its own (0 of 50), and the sway's `sizes`,
`panes`, `scene`, `sections`, `settled` and `soft` checks passed. A three-run A/B just before, at
load 3: `main` d8432e01 had `smooth` 2.1 % and `sway-smooth` 10.9 %; this change had 0 % and 0.6 %.

Rest CPU (`e2e/perf/rest.perf.ts`) was measured on the development bundles of this change and
of `main` d8432e01, alternating, seven runs each at a load of 2 to 6. The app's own process had a
median of 4.2 % of a core for both: 3.4 to 4.5 % for this change, 2.8 to 4.5 % for `main`. An
earlier three runs each, at a load of 2.4 to 11, gave medians of 4.5 % and 3.8 %, within that
spread. A 35 s trace of each desk at rest showed the same frames: two a second, a caret's blink,
none laid out. At rest the render thread sleeps until a frame is handed.
A window the OS withholds frames from is asked again once a second with the scene as it was, as
`main` asked it with an image alone.

Not measured: `just perf-motion --screen` on a 120 Hz display (none on the reference machine).
