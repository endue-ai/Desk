---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0165 (the stall it left on a locked screen, and the watch it left for a follow-up) and
ADR 0164 (what a page's ask says).

# A resize tells a page the screen only for a new scale, and a page that stops painting loads again

## Context and Problem Statement

After ADR 0165 one stall of #157 was left: with the Mac's screen locked, a plugin window's first
maximize (a double-click on its title) or first snap stopped its page for good, on main and with
ADR 0165's switch alike. The page's `requestAnimationFrame` never called back again, its texture
stayed a few pixels short of its pane (1276×757 in a 1278×758 pane), the clock went on counting
begin frames for it, and the page took input unseen (a terminal ran what was typed into it blind).
Nothing in the shell noticed: #157 also asks that the shell find a page that takes begin frames and
paints nothing though it asked for frames, say so, and bring it back without the person's help. Why
does a glide stop a page, and how does the shell keep a page from staying stopped?

## Decision Drivers

* No sequence of gestures leaves a page without frames (#157)
* A stalled page is said once, in the log and in `compositor_stats`, and comes back by itself
* No false stall: a page whose `requestAnimationFrame` loop changes nothing paints nothing too
* No patch to CEF or Chromium; ADR 0157's prompt frames (`inputFromRest`) keep their design

## Considered Options

* Tell the page's browser the screen only when the scale changes, and watch for a page that stops
  painting from its own asks, loading it again in its browser
* Keep telling the screen on every resize and only recover: every first maximize or snap would
  load its page again three to four seconds later, its unsaved page state lost each time
* Bring the page back in place: a hide and show (at once and a second apart), a resize by a pixel
  and back, a new frame rate, a zoom step, the focus, an invalidate and a begin frame of the
  shell's own each left the stalled page stalled (measured, below)
* Report a stall as the renderer's death (`died`), so the runtime's crash recovery (#44) loads it:
  the protocol's `died` is a process that ended, and a stalled renderer has not
* Watch begin frames against paints alone: a page whose loop draws nothing takes begin frames and
  paints nothing as well, and a frame of another site that Chromium throttles out of sight asks for
  frames it does not get

## Decision Outcome

Chosen option: "Tell the page's browser the screen only when the scale changes, and watch for a page
that stops painting", because the first removes the stall's trigger and the second brings back a
page that stops for any cause, without a false stall.

* **The resize** (`web_host.rs`, `View::rescaled`): `resize` calls `WasResized`, and
  `NotifyScreenInfoChanged` only when its scale differs from the one the browser last read. CEF holds
  a resize until the page has painted the size before it; the screen info call lays the page out
  again past that hold, with Chromium's default deadline, which the full pipeline makes infinite. A
  glide sends a resize a frame, each one both calls, so several new surface ids were in flight in
  one frame, and after them CEF sent the page no begin frame again. Chromium's trace of one stall
  (Terminal, the maximize): surface ids 81 to 84 in 17 ms (three from the screen info, one from
  `WasResized`); the page's renderer submitted its frame for begin frame 105 at the new size and the
  browser's compositor acked it, then no begin frame reached that browser for the 3.5 s traced while
  the clock called `SendExternalBeginFrame` about 20 times a second. A load of the page in the same
  browser brought it back at once: viz holds CEF's frame callback until every frame sink that began
  the frame has finished it, and a new page has a new frame sink.
* **The ask says how long it waited** (`frame_asks.js`, `renderer.rs`): `__deskNative.wake(ms)`, the
  milliseconds since the page's first ask for the wants still unmet (0 for a first ask). Only a page's
  main frame's asks count (`frame_asks::heard`).
* **The watch** (`web_host/stall.rs`, fed by the clock's look, `clock.rs`): a page is stalled when it
  asks again `AFTER` (3) times in a row, each after begin frames the clock sent it since the ask
  before, and it painted nothing meanwhile: three seconds, as a waiting page asks again a second on.
  A loop that draws nothing never asks again (its frames come); an ask no begin frame preceded (the
  surface hidden, asleep, the clock held) starts the count again.
* **What follows** (`web_host/revive.rs`): one line in the log (`endue Desk: surface … stopped
  painting: its page waited 3.0 s for a frame through 63 begin frames (#157); loading it again`),
  the view's counts in `compositor_stats` (`stalls`, `stalled`, `stall_reloads`, for every surface
  and for `page`), and a plugin surface's page loads again in its browser as a dead renderer's wake
  does; the runtime gives the new page its last `desk:state`, as after any load. A second load waits
  `AGAIN` (10 s) after the first. The desk's own page is only reported: loading it would restart the
  runtime.

### What the measures found (macOS 26, M4 Max, the screen locked, load average 35 to 45)

* A fresh desk 12 s after its start, Terminal's first maximize: main stalled it in 9 of 9 runs, and
  Status's first snap in the runs that reached it; with this change none of 6 maximizes (Terminal),
  3 maximizes (Status) and two runs of maximize, restore, snap, unsnap and a corner resize stalled,
  and the texture was the pane's size after each (1278×758; 632×758 snapped).
* `e2e/specs/frames-keep-coming.spec.ts`, its new plugin-window case: with the old resize it failed
  at the first maximize (texture 1276×757 and 1213×721 in a 1278×758 pane, no frames) and at the
  snap; with this change ten maximizes and restores, a snap there and back and a corner resize in
  moves 10 ms apart passed, and the watch found no stall.
* The watch, with the old resize kept on purpose: it found Terminal stalled 3.0 s after its page's
  first ask (63 to 66 begin frames), loaded it, and the page drew at its pane's size at once (23
  frames in 600 ms); a second stall within 10 s was said and loaded 10 s after the first. A desk of
  18 surfaces through the triggers and 60 s at rest: no stall found.

### Consequences

* Good, because a glide no longer stops the page it resizes, and a page that stops for another
  cause comes back within about four seconds, said in the log and the stats.
* Good, because the watch reads the page's own word: no false stall from a loop that draws nothing
  or from a frame Chromium throttles.
* Bad, because a page brought back is a new page: what it kept only in its DOM (a terminal's
  scrollback, a field not yet saved through `desk:state`) is gone; A6's surface state narrows that.
* Bad, because the page's screen (`screen.width`, `screen.availHeight`) keeps the size it had when
  its browser last read it, until the scale changes; no plugin or desk page reads it.
* Bad, because the desk's own page is only reported, and its own resize (`compositor_window.rs`)
  still tells the screen on every resize of the app window: ADR 0165's switch ended its stalls in
  the runs measured, but the same rule there is the next step if one comes back.

## More Information

Issue #157 (from the QA pass #154). Amends ADR 0165 and ADR 0164. Code: `apps/desk/shell/src/
web_host.rs`, `web_host/{view,stall,revive,clock,frames,frame_asks,client}.rs`, `frame_asks.js`,
`renderer.rs`, `client.rs`. Tests: `web_host/stall_tests.rs`, `web_host/view.rs`,
`web_host/frames_tests.rs`, `web_host/frame_asks.test.ts`, `e2e/specs/frames-keep-coming.spec.ts`.
No section of `docs/ko/desk-structure.md` changes.
