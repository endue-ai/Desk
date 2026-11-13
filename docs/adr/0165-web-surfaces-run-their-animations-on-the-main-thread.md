---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0157: the full pipeline stays, and Chromium's compositor no longer runs animations of its
own.

Status: amended by ADR 0170: the stall left on a locked screen came from a resize that told the
page's browser the screen as well, which a resize now does only for a new scale; and the shell
watches for a page that stops painting, says so and loads a plugin's page again. Amended by ADR
0210: the full pipeline is off (its display deadlocked the desk's page on a resize); the animations
stay on the main thread, and a press is held to the budgets ADR 0210 measured, RT-16's 16 ms the
target.

# Web surfaces run their animations on the main thread, so the full pipeline never stalls

## Context and Problem Statement

#157: a page stopped painting for good. On the person's desk the desk's own page stood still after
a rail popover was closed, a local agent's window was opened, a window's Floating mode was pressed
or the app window was resized: every click, wheel and resize after it changed the DOM and nothing
on screen, and a window dragged afterwards showed the page's old picture cut at its new place (the
trails, the stripes, another window's pixels). Plugin pages stopped the same way after a first
snap or maximize. `--run-all-compositor-stages-before-draw` (ADR 0157) makes the display wait for
every surface's frame without a deadline, and CEF sends no begin frame while one is out; a begin
frame that met an animation on the compositor's thread (the popover's fade, a window's transition)
never ended. How does the desk keep the full pipeline's press-to-paint and never stall?

## Decision Drivers

* No sequence of input, resizes or surface changes leaves a page without frames (#157)
* RT-16: a press to its paint within 16 ms at p95 (ADR 0157's reason for the full pipeline)
* No patch to CEF or Chromium; the desk's clock stays the desk's (ADR 0152)

## Considered Options

* Keep the full pipeline and turn off Chromium's threaded animations (`--disable-threaded-animation`)
* Drop the full pipeline: the stall goes, and a press again waits for a begin frame held to its
  late deadline (a median of 17 to 22 ms in ADR 0157's runs)
* Keep both and recover a stalled page: CEF has no call that ends a begin frame that is out; a
  hide and show, a resize, a new frame rate and an invalidate left the page stalled (#157)
* The rest of headless Chrome's deterministic set (`--disable-checker-imaging`,
  `--disable-threaded-scrolling`, `--disable-image-animation-resync`): each alone stalled as main did

## Decision Outcome

Chosen option: "Keep the full pipeline and turn off Chromium's threaded animations", because it
alone ended every stall the QA pass found while the press's paint keeps its time.

* **The switch** (`app.rs`) is on in every process beside the full pipeline: CSS transitions and
  animations of transform and opacity run on the renderer's main thread, each frame a main frame
  the display waits for, so a begin frame never meets a compositor frame nobody asked for.
* **What was measured** (macOS, M4 Max, a fresh desk 12 s after its ready line, the triggers of
  #157 through `compositor_input`): main stalled the desk's page at the first rail popover closed
  with Escape (1/1), a plugin page at its first snap and the desk's page after ten app resizes
  (3 stalls in one run); with the switch none stalled in three runs of the same steps (four rail
  popovers, the Inbox, a local agent's window, Floating mode there and back, Settings; maximize,
  restore, snap, unsnap, a corner resize, ten app resizes). `just perf-compositor`, the same hour,
  load average 2 to 3, three runs with the switch and two without: a press to its paint 8.3 to
  10.8 ms at p95 with it, 9.2 to 9.5 without; to its composed frame 13.2 to 17.3 and 13.2 to 15.5
  at the median; a press on a desk at rest 16.5 to 17.1 and 16.2 to 16.9 at p95, over its 16 ms
  both ways that hour (the machine, as #148 found); the desk at rest unchanged (10.2 wake-ups a
  second, 0.3 to 1.2 % CPU).

### Consequences

* Good, because no step the QA pass found stops a page any more, and the full pipeline's prompt
  frames keep a press's paint where ADR 0157 put it.
* Good, because one switch, Chromium's own, in every browser the desk makes.
* Bad, because an animation now waits for its page's main thread: a long task stalls a fade or a
  window's transition where the compositor's thread ran it alone (ADR 0157's full pipeline had
  already tied each frame to a main frame).
* Bad, because a stall of another cause still happens and goes unnoticed: with the Mac's screen
  locked, a plugin window's first maximize stopped its page in two tries of three, on main and with
  the switch alike (Terminal and Status, 2026-11-12 01:20), while unlocked the switch's runs had
  none in ten resizes; the shell does not yet watch a page that takes begin frames and paints
  nothing (#157's watchdog is left for a follow-up).

## More Information

Issue #157 (from the QA pass #154). Amends ADR 0157. Code: `apps/desk/shell/src/app.rs`. Tests:
`e2e/specs/frames-keep-coming.spec.ts` (the triggers on a desk ready 15 s, the page's frames after
each), `just perf-compositor`. No section of `docs/ko/desk-structure.md` changes.
