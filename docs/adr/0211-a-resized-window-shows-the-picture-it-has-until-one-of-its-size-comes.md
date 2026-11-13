---
status: accepted
date: 2026-11-14
decision-makers: Team endue
---

Part of ADR 0205's quality track (#232, #252). Amends ADR 0166 (a window drawn from its own page,
ADR 0201, is placed without waiting for the desk's page). Numbered past 0210, which another session
holds.

# A resized window shows the picture it has until one of its size comes

## Context and Problem Statement

While a window is resized, maximized or snapped, its frame takes the new size at once and its pages
(its own, ADR 0201, and its panes' plugins') paint the new size a frame or more later. On main
(6e75d95e) a corner dragged at 8 ms a step showed three faults, read back from the composed frames:

* **Scaled and clipped pictures**: CEF's off-screen capture lags the page by a frame. A paint made
  right after a new size carries the page laid out for the new size inside the texture of the old
  one: scaled down to fit or centred with black bars (`content_rect` short of `coded_size`), or
  clipped by it (`source_size`, the size the page laid out, not `coded_size`). The compositor drew
  it as the window's picture: the list shrank by a fifth for a frame with a dark band under it, or
  lost a few pixels at its edge.
* **Title under the tools**: the compositor's title ran to the window's new width while the picture's
  tools still stood where the old, narrower picture ended, so they covered the title.
* **Timing in place of sizes**: a window drawn from its own page still waited in `PageShown` for the
  desk's page to paint where its DOM had moved it (or for `QUIET_MS`, 150 ms, `REORDER_MS`, 40 ms),
  though the desk's page draws nothing of it.

How does a window decide what to show while its size changes, from what it has rather than from how
long it waited?

## Decision Drivers

* A window never shows another window's pixels, a stretched picture, or one laid out for another
  size scaled into its own
* Frame and content change size in the same frame once the page has painted the new size
* No millisecond threshold stands in for "the picture of the new size has come"

## Considered Options

* By the picture's size: draw the texture it has from the window's top left, one texel a device
  pixel, cropped or padded with the window's fill; drop a paint whose picture does not fill its
  texture; place a window with its own page where its DOM has it
* Scale the old picture to the new size (what a stretched resize looks like): fills the window,
  but every frame of a resize is a stretched one
* Hold the frame at the old size until a picture of the new size comes: the frame lags the pointer
  by the page's paint time, and a page that is slow to paint holds the resize

## Decision Outcome

Chosen option: "By the picture's size", as macOS draws a window whose content has not caught up.

* **Drawn by size** (`draw::sampled`, ADR 0201): a window's own page and each pane's plugin are drawn
  from the top left of their box, one texel a device pixel, as much as the texture holds; past it the
  window's fill. A texture larger than the box is cropped. The title keeps clear of the tools where
  the picture ends: `end` grows by how much narrower than the window the picture is (`draw.rs`).
* **A paint that does not fill its texture is not drawn** (`web_host/paint.rs`): `fills` says
  whether a view paint's `content_rect` is its whole `coded_size` and its `source_size` is that size
  (either not given counts as whole). One that does not is skipped, so the window keeps the last
  picture it drew; the next one that fills is attached whole, as the skipped one's damage never
  reached the compositor. At most `MOST_SKIPPED` (3) are skipped in a row, so a page whose paints
  never fill (none seen) still shows. It is a count of paints, not a time; the frame trace says each
  skip (`unfilled`) and `compositor_stats` counts them (`counts.unfilled`). A skipped paint is still
  the page painting: the frame clock, the stall watch (ADR 0170) and the popup's screen count it
  (`View::painted`). A popup's paints are attached as before.
* **Own pages are placed at once** (`hosted_picture.rs`): the windows drawn from their own page in
  the last scene leave `PageShown`; they are where their DOM has them. `QUIET_MS` and `REORDER_MS`
  stay for what still comes from the desk's page: a window before its own page has painted, and the
  parts of windows gone from it. They are not in the resize path of a window with its own page.
* **Judged on the person's test**: a window change is judged by growing and shrinking the app
  window quickly while a window inside the desk moves (#258 adds that scenario to `just perf-motion`,
  ADR 0208; this change adds no loop of its own to `e2e/perf/`). Until it lands, a local driver ran
  it and a corner resize of a window inside the desk (Measurements).

### Consequences

* Good, because each frame of a resize shows the window's own pixels at their size; a picture of the
  new size shows the frame it is attached.
* Good, because the decision is made from the texture's size and CEF's own paint info, the same at
  every speed and on a loaded machine; no wait is tuned.
* Bad, because while a window grows faster than its page paints, the strip past its picture shows
  the window's fill (as on macOS) instead of content.
* Bad, because a skipped paint's picture comes one paint later: a page that animates while resized
  shows its animation one frame late for each paint skipped.
* Bad, because one fault stays: a window's own page lays its section out at the size in the desk's
  state, which leads the page's size by a frame or two while a corner is dragged, so for those
  frames the title bar's tools are cut at the picture's edge. Sizing the section against its page
  (`100vw`, or `min(…, 100vw)`) would keep them whole, but the page then stopped growing once the
  window had been moved, and a press on its corner no longer resized it; it is left for its own
  issue.

### Measurements

* **Which paints**, on main 6e75d95e with every paint's info logged (the fixture desk, the Plugins
  window's corner swung ±80 px at 8 ms a step): of 844 paints, 765 had `content_rect` =
  `coded_size` = `source_size`. The 79 that did not were all the resized window's (its own page and
  its plugin): 66 scaled or centred (`content_rect` short), 13 clipped (`source_size` 1 to 3 px off
  the texture). Each lay between two paints that fill: never two in a row on any surface.
* **A window resized by its corner** (a local loop, not in the gate: the Plugins window grown
  120 px, its corner swung ±120 px at 1 Hz, a move every 8 ms for 3 s, 10 frames read back; each
  frame's body under the title bar compared from its top left with the body at rest in 8 px blocks,
  4 or more blocks off counted): main's frames had 7 of 10 off (18 to 71 blocks, up to 192 of 255
  on a channel); this change's had 0 of 30 in three runs, at 59.9 to 60 frames a second. A run
  skipped 83 to 103 scaled paints and 10 or 11 clipped ones, each alone between two that fill, so
  `MOST_SKIPPED` was never reached.
* **The app window grown and shrunk while a window inside moves** (a local driver until #258: the
  app window's frame ±300 × ±200 px around 1280 × 800 at 1.5 and 1.2 Hz, a new frame every 8 ms
  and a round trip; the Plugins window, placed clear of the dock, shaken ±120 px for 4 s, 12 frames
  read back), three runs on main and four here. The window inside showed its own pixels in every
  frame on both; the only blocks off were the Eris orb, which the desk draws above windows, coming
  over it as the app window widened. Here the desk's page skipped 5 to 150 paints a run and the dock
  up to 71, each alone; on main those paints, the desk laid out for its new size inside its old
  texture, were drawn. Intervals over 25 ms were 7.7 to 11.7 % here and 9.1 to 9.8 % on main (p95
  27 to 28 ms on both). The desk's page stopped painting mid-resize and the desk started again
  (ADR 0202) in one run of three on main and two of four here, each time after a paint that filled
  and was drawn: the failure of 2026-11-13 that #258 records, not changed here.
* **No millisecond threshold** is left in the resize path of a window with its own page: what is
  drawn follows the texture's size, what is skipped follows CEF's paint info, and the skip's bound is
  a count. `QUIET_MS` and `REORDER_MS` (ADR 0166) apply only to windows still drawn from the desk's
  page, of which the gate's runs had none (`fromDeskPage` 0). The compositor's glides (a snap, a
  maximize) run on the theme's motion tokens, durations of the motion itself, not waits for a
  picture; `SETTLE_MS` (`desk-wm/src/settle.rs`) belongs to the runtime's DOM glide and is not read
  by the compositor.

## More Information

Issue #252. Code: `apps/desk/shell/src/web_host/{paint,render,view,clock,popup_screen}.rs` and
`apps/desk/shell/src/compositor_window/{draw,hosted,hosted_picture,compose}.rs`. Tests:
`apps/desk/shell/src/compositor_window/draw_resize_tests.rs` (pictures of old and new sizes in any
order; an own page placed at once) and `apps/desk/shell/src/web_host/paint.rs` (which paints fill,
the skips). The resize scenarios are #258's to put in `just perf-motion`. No section of
`docs/ko/desk-structure.md` changes.
