---
status: accepted
date: 2026-11-14
decision-makers: Team endue
---

Supersedes ADR 0203 (the OS owns the screen). ADR 0140 and ADR 0156 stand again, amended: a window of
the desk may also live in an OS window of its own. Keeps from ADR 0203 the resident hub and the island
(ADR 0204), and amends ADR 0093 again (the order of the milestones).

# The desk keeps its screen, and its windows move out to the OS and back

## Context and Problem Statement

ADR 0203 (2026-11-13) left the screen to the OS after a day of measurements: on `main` 4e140552 a
window shaken at 2 Hz ran 39.7 frames a second in the development build and 58.0 optimized, one
optimized frame in four showed another window's pixels, the desk's page stopped painting until a
restart in two runs of five, and a window dropped at a fractional place stayed blurred. It froze the
compositor and planned every app in an OS window of its own (#234 landed that path behind a switch).

On review the person kept the desk's own screen. An infinite canvas the person pans, desktops, the
spread and the map are what no OS window gives, and the end state of ADR 0093, one app that is one OS,
needs a compositor: on Linux endue can be the Wayland compositor that places every app's windows, and
on a device of its own it is the whole screen. Meanwhile ADR 0201 (each window draws from a page of its
own) and ADR 0202 landed after the measurement: the torn frames came from window parts cut out of the
desk's one page, which ADR 0201 removes for windows, so they must be measured again. Two questions
remain. How does a window of the desk stand beside the OS's apps when the person needs it there? And
how does the compositor's window management reach the quality of an OS's, instead of being patched one
symptom at a time (140 of 425 commits in three days were fixes)?

## Decision Drivers

* An infinite canvas and endue's own window management: desktops, the spread, the map, snapping
* Any window usable beside the OS's own apps, on any display, as an app of its own
* endue manages every window it shows, in the desk or out of it, with one identity and its data
* No guess between a window's place and its picture, and no frame lost for good
* Quality proven on rendered pixels while windows move, as a gate, not by state at rest
* The end state: endue as the OS on Linux (a Wayland compositor) and on a device of its own

## Considered Options

* The OS owns the screen (ADR 0203): every app in an OS window, the compositor frozen
* The compositor desk as it is, fixing bugs as they come
* The compositor desk, whose windows pop out to OS windows and dock back, and a quality track that
  changes its structure where the measurements point, under a motion gate
* An infinite canvas drawn by one Chromium page with plugins as frames, the compositor frozen

## Decision Outcome

Chosen option: "the compositor desk with pop out and dock, and a quality track", because it keeps the
screen only endue can give and the windows the OS can give, and it turns the compositor's recurring bugs
into six structural changes judged by one measurement.

* **The desk is endue's screen** (ADR 0140, ADR 0156): the canvas, desktops, the spread, the map and
  snapping stay, and the desk is home. The island (ADR 0204) is what shows over other apps while the
  desk is not in front, and the core keeps running with no window (#237).
* **Pop out and dock** (#235). Any window can move out into an OS window of its own (a windowed CEF
  browser, the path of #234) and back to its place on the canvas. `desk-wm` keeps one id for it in or
  out and knows which; `desk.windows.*` and Eris's tools act on both; an out window keeps its place and
  size per app and display, and leaves tile, cascade, the spread and the map; `DESK_APP_WINDOWS` names
  plugins that open out by default. A windowless browser cannot become a windowed one, so a move in or
  out loads the page again and the plugin restores its state as after a sleep (`ui.surface.state`).
* **The quality track**, one issue each, in this order after the gate:
  1. A motion gate (#247): a frame trace and a shake run on every change to the compositor,
     `desk-wm` or the off-screen host, and fail on dropped frames, a window showing pixels not its own,
     a page that stops painting, and a window softer at rest than at a whole pixel.
  2. No frame lost for good (#248): a frame deadline replaces the full pipeline's wait (ADR 0157); ADR
     0202's restart stays as a backstop.
  3. The display's clock and a render thread (#249): frames follow the display's refresh, apart from
     CEF's pump and the bridge.
  4. Whole device pixels and clipped corners (#250).
  5. One owner of focus (#251): `desk-wm` decides; the page and the router follow.
  6. A resize commits by the texture's size (#252): the old picture cropped or padded until a picture
     of the new size arrives, instead of timing thresholds.
* **The rule.** A change to the compositor, `desk-wm` or the off-screen host keeps the motion gate
  green, and adds no millisecond threshold without a measurement in its ADR.
* **The end state.** On Linux, endue runs as the Wayland compositor of a session (the DRM spike of #60
  is the start) and places every app's windows with the same compositor; on its own device it is the
  whole screen. On macOS and Windows the OS's apps stay outside the canvas: endue reaches them through
  computer use and recalls their places in workspaces.

### Consequences

* Good, because the canvas and endue's own window management stay, and any window can still stand
  beside the OS's apps
* Good, because one compositor serves the desk now and endue as the OS later
* Good, because a measured gate stops the cycle of a fix and a regression the tests at rest never saw
* Bad, because a window has two hosts: its focus, keys and state must agree across the canvas and the
  OS window, which #235 and #251 carry
* Bad, because the compositor's cost stays (about 39,000 lines of Rust) and the quality track is real
  work on CEF's off-screen path, which says nothing of which layout a picture shows; #252 avoids
  needing that signal
* Bad, because a move in or out reloads the page
* Bad, because on macOS and Windows endue never places another app's windows on its canvas

## More Information

ADR 0203's measurements and the trace that made them: `DESK_FRAME_TRACE` in an unmerged worktree, taken
up by #247. The epic is #232; #236 (home in an ordinary window) and #240 (the compositor out of the
default build) are closed as not planned, #239 keeps the app format without dropping the desk's frame
API. `AGENTS.md` replaces ADR 0203's freeze with the rule above, and both roadmaps take this order.
