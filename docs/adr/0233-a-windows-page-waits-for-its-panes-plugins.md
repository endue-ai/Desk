---
status: accepted
date: 2026-11-15
decision-makers: Team endue
---

Amends ADR 0211 and ADR 0227 (a window's own page's picture of a new size is no longer drawn as it
comes while a pane's plugin has none of the size it leaves it).

# A window's page waits for its panes' plugins

## Context and Problem Statement

A window drawn from its own page has its frame and title bar at the size of that page's
picture (ADR 0211), and each pane in it at what that frame leaves. ADR 0227 keeps a plugin's paint
of a size its pane is not drawn at aside until the frame is of its size, which ended the content
running ahead of its frame. The other way was left: when the window's page paints a new size before
the pane's plugin does, the frame grows or shrinks and the plugin's picture of the size before is
drawn in it, cropped or padded. In the motion gate's sway that was 12 to 118 of about 470 layouts a
run (ADR 0227, Measurements); which of the two leads changes from run to run.

How does a window's frame wait for its panes' plugins without waiting on a clock?

## Decision Drivers

* A window's frame and the plugin in each pane change size in the same frame, either way
* Counts, not times (ADR 0205, ADR 0208)
* A plugin that never paints its size, or a window whose page does not, still shows
* What ADR 0227 holds stays: a plugin's paint ahead of its pane waits for the frame

## Considered Options

* Hold the window's page's picture aside until every pane's plugin has a picture of the size it
  leaves that pane, shown or aside
* Tell the window's page its size only once its plugins have painted theirs: every resize shows a
  plugin's paint time later, at rest too
* Draw the plugin stretched to its pane while it trails: the content's text and lines blur and
  jump

## Decision Outcome

Chosen option: "hold the window's page's picture aside", because the compositor already knows each
paint's size, each plugin's pictures aside (ADR 0227) and where a frame of a size leaves each pane.

* **A paint of a new size goes aside** (`compositor_window/composed_window.rs`): a window page's
  paint of another size than its picture, in a window drawn with a live plugin pane, is copied into
  a texture aside, and the window keeps the picture it shows. A paint of the shown size draws as it
  comes, and the pictures aside, older, go.
* **The scene that finds every plugin ready shows it** (`Composed::pages_wait`, before each layout
  in `compose.rs`): for each picture aside, the size it leaves each pane is worked out as
  `draw::window` draws it (`Paned::leaves`: the frame at that size from the window's anchor, each
  pane in it by `anchor::within`); when every pane's plugin has a picture of its size, the one it
  shows or one aside, to a pixel, the newest such picture becomes the window's and the older ones go.
  The scene then draws the frame at that size, and ADR 0227 shows each plugin's picture aside of its
  pane's size in the same frame.
* **Counts, not times**: four sizes wait at most, the newest (`KEPT`); after eight paints aside in a
  row (`MOST_ASIDE`) the next is drawn as it comes; after eight scenes laid out with a picture
  waiting (`MOST_LOOKS`) the newest is shown. While one waits each frame drawn asks for the next
  (`Composed::drawn` leaves the scene dirty), so the count of scenes runs on a desk at rest too, and
  each plugin paint lays the scene out again. A paint aside that the compositor could not take is
  dropped, never shown.
* **What it covers**: windows drawn from their own page with one pane, a plugin's that is awake,
  answering and not crashed. A plugin with no picture yet is not waited for; another window draws
  its page as it comes. A lone pane lies at fixed insets from the frame, so the size worked out for
  a picture is the size its plugin was told with it. A split's panes take a share of the body
  (`desk_wm::host::panes`), and the scene draws them from the newest plan (`anchor::within`): for a
  size before it no pane's size is the one its plugin painted, and the wait would end only by its
  counts, the frame changing about once in nine paints. Splits wait once the scene lays their
  panes out by share at the frame's size (a follow-up).
* **In the gate**: `sway-panes` gets a limit, `maxPaneShare` in `e2e/perf/motion.json`: 1.5 % of
  the sway's frames, from the runs below.

### Consequences

* Good, because a window's frame and the plugin inside it change size together whichever
  of its page and its plugin paints first
* Good, because nothing waits on a clock: a slow plugin holds its window's frame longer, not wrongly
* Bad, because a window being resized shows each size up to its slowest plugin's paint later
* Bad, because up to four more textures of a window's size live per window while it is resized
* Bad, because while a picture waits each frame lays the scene out again, up to `MOST_LOOKS` frames

## More Information

### Measurements

The motion gate's sway (`just perf-motion`, optimized, off screen, an M4 Max, 2026-11-16), three runs
a batch, read from each layout of the Terminal's window, which fills the app's right half: the
frames where its plugin's picture is of another size than its pane (`sway-panes`). The builds of a
pair are the same tree, with only this change's files swapped for `main`'s, run back to back.

| batch | load average at each run | `main` | this change |
| --- | --- | --- | --- |
| on `main` 3aece0b4 | 2.8 to 4.9 | 207 of 1317 (15.7 %), 172 of 1314 (13.1 %) | 16 of 1306 (1.2 %) |
| on `main` 55ed3326 | 4.5 to 7.3 | 259 of 1227 (21.1 %) | 10 of 1183 (0.8 %) |

* One more batch with this change on 3aece0b4 read 411 of 1283: in its first run the Terminal's
  window page painted nothing for 15 s (CEF; the wait held its next picture 34 ms), and its plugin's
  pictures were of the new sizes against the old frame throughout. Its other two runs read 3.
* `sway-sizes`, `sway-scene`, `sway-sections` and `sway-settled` read 0 or none in every run of both
  builds.
* `maxPaneShare` is the worst batch without a page that stopped painting, plus 10 %, rounded up to
  the half percent: 1.5 %. A run where a window's page stops painting fails it, as it should.
* The resize loop: on 3aece0b4 this change's runs stalled the Terminal's plugin (#157 watch) in 5 of
  6 and `main`'s in none of 6. On 55ed3326 both did in 3 of 3, back to back, with the screen tellings
  each view hears and the Terminal's placements traced: the plugin was told its screen 5 to 13 times
  a run on `main` and 9 to 14 with this change, its place changed 521 to 680 and 486 to 554 times.
  The wait adds neither, and the stall is `main`'s since the terminal's changes after 3aece0b4.
* The single shake fails on `main` and with this change alike ("the window did not move with the
  pointer", #331).

Issue #284.
