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
(6e75d95e) a corner dragged at 8 ms a step showed four faults, read back from the composed frames:

* **Scaled and clipped pictures**: CEF's off-screen capture lags the page by a frame. A paint made
  right after a new size carries the page laid out for the new size inside the texture of the old
  one: scaled down to fit or centred with black bars (`content_rect` short of `coded_size`), or
  clipped by it (`source_size`, the size the page laid out, not `coded_size`). The compositor drew
  it as the window's picture: the list shrank by a fifth for a frame with a dark band under it, or
  lost a few pixels at its edge.
* **Pictures cut or padded**: the frame at its new size showed the old picture cut at its edge or
  with a strip of the window's fill; under the motion gate's sway (ADR 0213) a window that follows
  the app window's size did so in 82 % of the frames.
* **Title under the tools**: the compositor's title ran to the window's new width while the picture's
  tools still stood where the old, narrower picture ended, so they covered the title.
* **Timing in place of sizes**: a window drawn from its own page still waited in `PageShown` for the
  desk's page to paint where its DOM had moved it (or for `QUIET_MS`, 150 ms, `REORDER_MS`, 40 ms),
  though the desk's page draws nothing of it.

How does a window decide what to show while its size changes, from what it has rather than from how
long it waited?

## Decision Drivers

* A window never shows another window's pixels, a stretched picture, or one laid out for another
  size: scaled into its own, cut or padded
* Frame and content change size in the same frame once the page has painted the new size
* No millisecond threshold stands in for "the picture of the new size has come"

## Considered Options

* The frame by the picture: a window drawn from its own page has its frame at its picture's size,
  from its place's top left; a paint whose picture does not fill its texture is dropped; the window
  is placed where its DOM has it
* Crop or pad: the frame at the window manager's size at once, the picture drawn from its top left,
  cropped or padded with the window's fill, as macOS draws a window whose content has not caught up.
  The frame never lags, but a fast resize shows the picture cut or padded in most frames
* Scale the old picture to the new size (what a stretched resize looks like): fills the window,
  but every frame of a resize is a stretched one

## Decision Outcome

Chosen option: "The frame by the picture": what a window shows is always one picture whole, in a
frame of its size.

* **The frame by the picture** (`draw.rs`, `pictured`): a window drawn from its own page is drawn at
  its picture's size (the texture's device pixels over the scale) from the top left of its place,
  frame, title bar, corners and all, and its picture one texel a device pixel (`draw::sampled`).
  Within a device pixel of its place's size it is drawn at its place, so at rest it keeps ADR 0209's
  whole pixels. Once the page paints the new size, frame and content take it in the same frame. A
  pane's plugin, a browser of its own, is still drawn from its pane's top left, cropped or padded
  with the window's fill, while its page catches up; the desk's own page likewise (ADR 0213's
  `sway-scene`, #269).
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
* **Judged on the person's test**: the motion gate's sway (ADR 0213, #258) grows and shrinks the app
  window while a window inside moves; `sway-sizes` leaves `known` (Measurements).

### Consequences

* Good, because no frame of a resize shows a window's own picture cut, padded, scaled or stretched;
  frame and content change size together.
* Good, because the decision is made from the texture's size and CEF's own paint info, the same at
  every speed and on a loaded machine; no wait is tuned.
* Bad, because the frame lags the pointer, or the app window's edge for a window that fills, by the
  page's paint time: a frame or more, longer for a page slow to paint. The window manager's place
  (where the window takes the pointer and snaps) runs ahead of what is drawn for those frames.
* Bad, because a page that stops painting keeps its window at its last picture's size until the
  stall watch (ADR 0170) starts it again.
* Neutral, because the desk's own page still stops painting at times while the app window is
  resized fast and the desk starts again (#248, ADR 0202): as often or more here in the gate's
  runs, not separated from #264's shell by them (Measurements).
* Bad, because a pane's plugin is still cropped or padded inside its window while its own page
  catches up.
* Bad, because a skipped paint's picture comes one paint later: a page that animates while resized
  shows its animation one frame late for each paint skipped.
* Bad, because one fault stays inside the picture: a window's own page lays its section out at the
  size in the desk's state, which runs ahead of the page's size while the window's size changes,
  so the section is cut at the picture's edge as the window grows (the title bar's tools, for a
  frame or two of a corner drag) and leaves a strip of the page's background as it shrinks. Under
  the sway the Terminal's page and its place differed by more than a few pixels in 8 of 10
  captured frames, by up to 98 px; `sway-sizes` compares the texture with the frame and cannot
  see it. Sizing the section against its page (`100vw`, or `min(…, 100vw)`) would keep it laid out
  for its page, but the page then stopped growing once the window had been moved, and a press on
  its corner no longer resized it; it is left for #270 (ADR 0214).

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
  `MOST_SKIPPED` was never reached. (Measured before the frame took the picture's size; the
  picture is drawn the same way, whole from the window's top left.)
* **The motion gate's sway** (ADR 0213, `just perf-motion`, optimized, off screen: the app window
  1024 to 1624 wide and 600 to 1000 high on two sines while the Plugins window shakes and the
  Terminal fills the app's right half; 2026-11-14 on an M4 Max). Two gate runs of three here (load
  average 11.8 and 4.9) against #264's shell the same hour (6.3), and its recorded baseline of
  2026-11-13 in brackets:
  * `sway-sizes`, frames where a window's picture is cut or padded: 0 of 1325 and 0 of 1163 here;
    1313 of 1403 on #264's shell (1148 of 1408). It leaves `known`.
  * `sway-own-pixels`: 0 of 28 and 2 of 24 frames off here, 1 of 30 on #264's shell (2). The two
    here were the dock, drawn above windows, coming over the shaken window as the app window
    shrank, not the window's picture. It stays in `sometimes`.
  * `sway-scene`, the desk's own page against the scene drawn with it: 714 of 1325 and 669 of 1163
    here, 569 of 1403 on #264's shell (670 of 1408). Not fixed: the desk's page is drawn as the
    app window, not by the frame rule, and its texture trails the app window's size as before. In
    runs where the desk's page kept painting it was 153 of 467 here against 182 to 200 of about
    470 on #264's shell; the totals are higher here because the desk's page stopped mid-sway in
    more of these runs (below) and every frame after counted. It stays `known`, for #269.
  * `sway-painting`: the desk's page stopped painting mid-sway (the #157 watch, then ADR 0202's
    restart) in 5 of 6 runs here and 0 of 3 on #264's shell. Run interleaved with it, one sway at
    a time from prebuilt bundles under the same load (6 to 150, other sessions' builds), it
    stopped in 7 of 9 here and 5 of 9 on #264's shell, and in 2 of 4 with the desk's own paints
    never skipped. The stall is #248's, on both; these samples do not tell whether this change
    makes it more likely. Each time here the desk's last paint before it filled its texture and
    was drawn.
  * `sway-fps` 57.7 to 58.8 here and 57.7 to 59 on #264's shell; intervals over 25 ms 6.9 to
    11.1 % and 11.5 to 15.4 % (`sway-smooth`, #249).
  * The single shake (ADR 0208) passed every check in both gate runs here but `smooth` in the
    first (2.1 % against 2 %, at load 11.8; 1.7 % in the second).
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
the skips). The gate: `e2e/perf/motion.json` takes `sway-sizes` out of `known`. No section of
`docs/ko/desk-structure.md` changes.
