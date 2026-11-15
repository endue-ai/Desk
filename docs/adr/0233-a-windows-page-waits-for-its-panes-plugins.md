---
status: accepted
date: 2026-11-15
decision-makers: Team endue
---

Amends ADR 0211 and ADR 0227 (a window's own page's picture of a new size is no longer drawn as it
comes while a pane's plugin has none of the size it leaves it).

# A window's page waits for its panes' plugins

## Context and Problem Statement

A window drawn from its own page has its frame, title bar and focus ring at the size of that page's
picture (ADR 0211), and each pane in it at what that frame leaves. ADR 0227 keeps a plugin's paint
of a size its pane is not drawn at aside until the frame is of its size, which ended the content
running ahead of its frame. The other way was left: when the window's page paints a new size before
the pane's plugin does, the frame grows or shrinks and the plugin's picture of the size before is
drawn in it, cropped or padded. In the motion gate's sway that was 12 to 118 of about 470 layouts a
run (ADR 0227, Measurements); which of the two leads changes from run to run.

How does a window's frame wait for its panes' plugins without waiting on a clock?

## Decision Drivers

* A window's frame, its ring and the plugin in each pane change size in the same frame, either way
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
  waiting (`MOST_LOOKS`) the newest is shown. While one waits each scene asks for the next, and each
  plugin paint lays the scene out again.
* **What it covers**: windows drawn from their own page with a plugin pane that is awake and not
  crashed. A plugin with no picture yet is not waited for; a window with no such pane draws its page
  as it comes.
* **In the gate**: `sway-panes` gets a limit, `maxPaneShare` in `e2e/perf/motion.json`, from the
  runs below.

### Consequences

* Good, because a window's frame, its ring and the plugin inside it change size together whichever
  of its page and its plugin paints first
* Good, because nothing waits on a clock: a slow plugin holds its window's frame longer, not wrongly
* Bad, because a window being resized shows each size up to its slowest plugin's paint later
* Bad, because up to four more textures of a window's size live per window while it is resized
* Bad, because while a picture waits each frame lays the scene out again, up to `MOST_LOOKS` frames

## More Information

### Measurements

To be recorded on a quiet machine: the motion gate's sway on `main` and with this change, the
layouts where a plugin's picture is of another size than its pane, ahead and behind, and
`sway-panes`.

Issue #284.
