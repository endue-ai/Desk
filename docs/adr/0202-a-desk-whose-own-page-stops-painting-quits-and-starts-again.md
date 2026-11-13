---
status: proposed
date: 2026-11-13
decision-makers: Team endue
---

Amends ADR 0170 (a stalled page loads again; the desk's own page was only reported) and ADR 0177
(quitting asks about unsaved changes). Numbered past ADR 0201, which an open pull request holds.

# A desk whose own page stops painting quits and starts again

## Context and Problem Statement

ADR 0170's watch brings a plugin's page that stopped painting back by loading it again in its
browser, which gives it a new frame sink. The desk's own page was only reported: loading it would
restart the runtime under every plugin's page. On the person's desk on 2026-11-13 that page stopped
painting after the app window was resized by hand (the resize told the page the screen on every size,
the trigger ADR 0170 removed from plugin surfaces only) and stayed frozen for about nine hours: the
bars, Eris, every window's title-bar tools and the windows the page draws itself (endue agent cards,
local agent screens, seven of the ten windows) showed their last picture until the desk was quit by
hand. Its scripts went on, so a quit still asked the page, whose question nobody could see. How does
the desk get its page back without losing work, and without a patch to CEF?

## Decision Drivers

* A frozen desk page comes back by itself, as a plugin's page does, within seconds
* Nothing unsaved is lost, and no question is asked that nobody can see
* A stall that comes back at once cannot restart the desk over and over
* No patch to CEF or Chromium; the trigger found is removed as well

## Considered Options

* Quit the desk the way the person's quit does, then start a new desk, with nothing unsaved
* Load the desk's page again in its browser: the runtime starts over while every plugin's page
  keeps running, with no host for its messages, its `desk:state` gone and its unsaved buffers
  unknown to the new runtime; nothing on the desk was built or tested for that
* Bring the page back in place: ADR 0170 measured hide and show, a resize, a frame rate, a zoom, the
  focus, an invalidate and a begin frame of the shell's own, and none brought a page back
* Draw a notice of the compositor's own with a button to start again: the person still meets a
  frozen desk and has to find the notice; kept as a follow-up for a desk that may not restart

## Decision Outcome

Chosen option: "Quit the desk the way the person's quit does, then start a new desk", because it is
made of paths the desk already runs (the quit of ADR 0177, the start of ADR 0187 and ADR 0189) and
it loses nothing that the person's own quit would keep.

* **The trigger** (`compositor_window/page.rs`): the app window's resize tells the desk's page the
  screen only when the scale changes, as ADR 0170 made a plugin surface's resize do.
* **The quit** (`web_host/revive.rs`, `quit.rs`): when the watch finds the desk's page stalled, the
  shell asks the page `desk://quit` with `{ "why": "stalled" }`. The page (`apps/desk/src/quit.ts`)
  asks nobody: it answers `quit` with no buffer modified, and `stay` with any, or while the person's
  own quit question is up. The shell takes `asking` as `stay`, never brings the desk forward for it,
  and quits when the page gives no answer within the quit's wait (3 s), as any quit does.
* **The new desk** (`main.rs`, `stall_restart.rs`): after that quit and CEF's shutdown, the shell
  lets go of the single-instance lock and starts its own binary again with `DESK_STALL_RESTART`, the
  time of this start. An update that asked to restart goes first.
* **Once** (`stall_restart::may`): a desk started for a stall less than 10 minutes ago only reports
  a stall of its own, so a stall that comes back at once leaves the desk frozen, as before, instead
  of starting it over and over.

### Consequences

* Good, because a frozen desk page comes back in the time a quit and a start take, with what the
  desk keeps across a start (its windows and their places, ADR 0189), and nothing unsaved lost.
* Good, because no question is drawn on a page that cannot show it.
* Bad, because what lives only in plugins' pages and is not kept across a start (a terminal's
  scrollback, a scroll position) is gone, as after the person's quit.
* Bad, because a desk with anything unsaved stays frozen until the person saves through another
  window or quits by hand; the log says why.
* Bad, because a second stall within 10 minutes stays frozen until a start by hand.
* Neutral: the quit is marked clean (ADR 0187), so the new desk says nothing about a run that did
  not quit.

## Validation

Unit tests only, by request: the shell's quit steps for a stalled page (`quit_tests.rs`), the guard
against a second start (`stall_restart.rs`), the app window's resize (`compositor_window/page.rs`),
and the page's answers (`apps/desk/src/quit.test.ts`). The app e2e `frames-keep-coming.spec.ts`
resizes the app window several sizes a frame and was not run here.

## More Information

Issue #157 and the person's report of 2026-11-13. Code: `apps/desk/shell/src/{quit.rs,
stall_restart.rs,main.rs,update.rs}`, `web_host/{revive,stall}.rs`, `compositor_window/page.rs`,
`crates/desk-boot/src/start.rs` (`relaunch_with`), `apps/desk/src/quit.ts`.
