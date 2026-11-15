---
status: accepted
date: 2026-11-15
decision-makers: Team endue
---

Amends ADR 0211 (a pane's plugin is no longer drawn as it comes while its window's size changes).

# A plugin's picture waits for its window's frame

## Context and Problem Statement

A window drawn from its own page has its frame, title bar and focus ring at the size of that page's
picture (ADR 0211), and a pane in it is what that frame leaves. The pane's plugin is a browser of
its own. While the app window was made wider and narrower fast, the person saw the focus ring move
later than what the window shows inside it.

Read from the motion gate's sway (`just perf-motion`, the Terminal filling the app's right half, a
new size about every 33 ms; 2026-11-15, main e8356d39): the window's page and its plugin are told
each new size in the same step, but a planned size reached the plugin's picture after 35 ms
(median, 52 ms at p90) and the window's page after 57 ms (78 ms at p90). CEF holds a view's next
size until it has painted the last one. The plugin's paint of a size came just before the next step
and the window's page's just after, so the page took its next size a whole step later, and its
first paint of a new size was at times one that does not fill its texture, which is not drawn (ADR
0211). In 241 of 459 layouts of the sway the plugin's picture was of another size than its pane, by
37 px on average, and in 187 of those it was the plugin that was nearer the planned size: the
content ran a step ahead of its frame and ring.

How do a window's frame and the plugin inside it change size in the same frame?

## Decision Drivers

* The frame, the ring and the content of a window change size together
* No millisecond threshold stands in for "the frame has come" (ADR 0205, ADR 0208)
* A window still shows one picture whole in a frame of its size (ADR 0211, `sway-sizes`)
* A plugin slow to paint, or one whose pane never takes its size, still shows

## Considered Options

* Hold the plugin's picture aside until the scene draws its pane at that picture's size
* Draw the frame at the planned size at once, the window's picture cut or padded (what ADR 0211
  left behind: most frames of a fast resize show it)
* Tell the plugin its size only once the window's page has painted it: the content then trails the
  frame by the plugin's paint time, and both come later
* Make the window's page as fast as the plugin: its hold is CEF's, and its page shares the desk
  page's renderer thread

## Decision Outcome

Chosen option: "hold the plugin's picture aside", because it needs nothing of the pages' timing:
the compositor already knows each pane's size as drawn and each paint's size.

* **A paint ahead of its pane goes aside** (`compositor_window/composed_pane.rs`): a plugin's paint
  of another size than its pane's, as the last scene drew it, is copied into a texture aside, and
  the plugin's picture stays the one it shows. A paint of the pane's size, of the size shown, or of
  a size the pane was drawn at before (the last 16: there the plugin trails its frame, and its
  newest picture is the nearest it has) is drawn as it comes.
* **The scene that draws the pane at a size aside shows that picture**
  (`Composed::panes_drawn`, `compose.rs`): after the scene is laid out, each pane's size is looked
  up among its plugin's pictures aside; one found becomes the plugin's picture and the scene is
  laid out once more in the same frame, so the frame, the ring and the content change together.
* **Counts, not times**: four sizes wait at most, the newest (`KEPT`); after eight paints aside in
  a row (`MOST_ASIDE`) the next is drawn. A paint that goes to another texture than the one before
  is copied whole, as its damage names only what changed since that one.
* **What it covers**: plugin panes in windows. A window's own page, the desk's page (ADR 0215), a
  web view (ADR 0216) and popups are drawn by their own rules. A plugin not drawn keeps nothing
  aside.
* **In the gate**: `sway-panes` reports the sway's frames where a pane's plugin shows a picture of
  another size than its pane, with no limit yet (Measurements).

### Consequences

* Good, because the content no longer runs ahead of its window's frame and ring
* Good, because nothing waits on a clock: a slow machine holds a picture longer, not wrongly
* Bad, because the content of a window being resized shows a size up to the window's page's paint
  time later than before (about a step of a fast resize); the frame did already
* Bad, because up to four more textures of a pane's size live per plugin while its window's size
  changes
* Bad, because a plugin slower than its window's page is still drawn cropped or padded in its pane
  until it paints (ADR 0211)
* Neutral, because a picture aside shown later is as the plugin painted it then: what it painted
  since at other sizes comes with those sizes

## More Information

### Measurements

The motion gate's sway (`just perf-motion`, optimized, off screen, an M4 Max, 2026-11-15), read from
each layout of the Terminal's window: its plugin's picture against its pane as drawn, and which of
the two is nearer the planned size. Other sessions were building on the machine (load average 15 to
60), so the numbers are of single runs, not a quiet baseline.

* **Which of the two leads changes from run to run.** The plugin's paint of a size and the next
  step of the resize are a millisecond or two apart, so a run falls on one side or the other: on
  main e8356d39 one run had the plugin ahead in 187 layouts and behind in 54 (of 459); three later
  runs with the rule switched off had it ahead in 1, 4 and 7 and behind in 29, 122 and 117 (of 468
  to 483).
* **With the rule** (six runs): ahead in 6, 8, 0, 3, 9 and 1 layouts; behind in 95 (two sizes
  kept), then 66, 12, 63, 118 and 34 (four kept, of 390 to 487). 340 to 420 pictures aside were
  shown a run.
* **Not changed by it**: the plugin behind its frame, which is still cropped or padded (ADR 0211).
  Holding the window's page's picture as well, until every pane's plugin has one of its size,
  would close it; it is left for a follow-up, with these numbers.
* **The gate beside it**, three runs each interleaved under the same load: `sway-fps` 56.5, 55.7
  and 59.7 with the rule, 57.2, 57.8 and 59.1 without; `sway-sizes`, `sway-scene`, `sway-sections`
  and `sway-own-pixels` 0 in all six; no page stopped. One earlier pair of runs at a load average
  of 35 to 63 gave `sway-fps` 47.3 with the rule; no run without it was made at that load.
* `sway-panes` reports the frames where a plugin's picture is not its pane's size, either way: 6.9
  to 27.8 % with the rule, 6.3 to 27 % without, in those runs. It has no limit yet
  (`maxPaneShare`), as most of it is the plugin behind.

Issue #283.
