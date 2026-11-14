---
status: accepted
date: 2026-11-14
decision-makers: Team endue
---

Part of ADR 0205's quality track (#232), for #270: the fault ADR 0211 left inside the picture.

# A window's section fills its own page, and its page told its screen paints once

## Context and Problem Statement

Since ADR 0201 each window's section lives in a page of its own, which the shell sizes from the
compositor's plan (`place_window_pages`, then `WasResized`). The runtime still laid the section out
at its window's rect in CSS pixels, as in the desk's page. Two clocks sized one box: the window
manager's rect, written on the desk's draw, and the page's viewport, set by the shell. While a window
was resized, a frame laid out by one before the other showed the section cut at the page's edge (the
title bar's tools, during a corner drag) or the page's background past it. ADR 0211 draws each
window's frame at its picture's size, so `sway-sizes` passes, but a picture laid out wrong inside is
still that size.

Sizing the section by its page alone (`100vw`, `100vh`) showed a second fault: a window moved and then
resized kept its page at the old size. Once a view rests at a new place the shell tells its page its
screen (`popup_screen.rs`, for where popups open, #156), and CEF's off-screen view then holds every
resize (`ResizeRootLayer`) until the view paints a frame at its size. A page whose section follows its
viewport changes nothing when its window moves, so it painted nothing and each later `WasResized`
stayed pending. On `main` the section's new rect on the next resize painted a frame at the old size,
which ended the hold one frame late: the cut frame.

## Decision Drivers

* No frame of a window's page shows its section laid out for another size than the page
* A window moved and then resized takes its new size at once
* No frames asked for while nothing changes
* The motion gate sees it (ADR 0208): `sway-sizes` compares a picture with its frame, not what is in it

## Considered Options

* The section fills its own page, and the shell asks the window's page for a whole frame after
  telling it its screen (`Invalidate(PET_VIEW)`)
* The rect in pixels, written from the page's own `resize` event instead of the desk's draw: the
  rect and the viewport still part for a frame whenever the desk draws first
* No screen told for a move: the page's popups would open where its window was
* A change to the page's DOM after each telling: the runtime would guess at the shell's CEF state

## Decision Outcome

Chosen option: "The section fills its own page, and the shell asks the window's page for a whole
frame after telling it its screen", because the page's viewport is the one size its frames are laid
out for, and the hold is CEF's: the shell, which tells the screen, also ends it.

* **The runtime** (`packages/runtime/src/surface/section-place.ts`): in its own page a section lies at
  `0 0 100vw 100vh`, written once; in the desk's page at its window's rect, as before.
* **The shell** (`web_host/popup_screen.rs`, `tell_screens`): for a window's own page
  (`window:<id>`), `notify_screen_info_changed` is followed by `invalidate(PaintElementType::VIEW)`,
  once per settle (`SETTLE`, 150 ms at rest), never in motion. A plugin's page is told as before: it
  paints of its own, and ADR 0210 catches up one that does not. The gate's resize loop lost a
  plugin's page (ADR 0210's stall) in 2 of 9 runs with the frame asked of every view, in 1 of 6 with it
  asked of window pages only (a set started at a load average of 11.5), and in 1 of 23 runs of other
  builds that day: the stall is ADR 0210's either way, and the frame goes only where it is needed.
* **The gate** (`e2e/perf/support/sections.ts`, `lib/motion-sections.ts`): `sway-sections`, ADR
  0213's ninth sway check. Through DevTools each `desk-window:` page notes, at every frame where its
  viewport or its section changes size (`resize` before layout, `ResizeObserver` after it), both
  sizes; a frame whose section is more than 1 CSS pixel off its page counts. The limit is ADR 0208's
  `maxUnfitFrames`, 0; a sway where no page noted a frame measured nothing and fails.

### Consequences

* Good, because a section cannot be laid out for another size than its page: there is one size
* Good, because a moved window resizes at once; on `main` its first resize after a move lands a frame
  late
* Bad, because each settled window page paints one whole frame, even with nothing new
* Bad, because the check adds a DevTools session to every window page for the sway and a callback in
  each frame where a page's size changes
* Neutral, because a pane's plugin, a browser of its own, is still drawn from its pane's top left while
  its page catches up (ADR 0211): this lays out the window's section, not the plugins' pages in it

## More Information

Measured with `just perf-motion` on the reference machine (macOS, M4 Max, headless at 1x): see
`docs/qa/TESTING.md` for the sway's table with `sway-sections`, and #270's pull request for the
runtime laid out as on `main` against this shell.
