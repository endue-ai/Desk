---
status: accepted
date: 2026-11-14
decision-makers: Team endue
---

Part of ADR 0205's quality track (#232, #269). Extends ADR 0211 (a window's frame follows its picture)
to the desk's own page.

# The desk's page is drawn with the scene its picture was laid out for

## Context and Problem Statement

The desk's page (the runtime's page, the desk's system surface, ADR 0160) sends the compositor two
things apart: its report (`compositor_desk`: the size it laid itself out for, its bars' and its named
parts' boxes, where the edge surfaces such as the dock go, the desk it took from the window manager)
and its picture (its paints). The compositor lays the scene out from the last report and draws the
page's last picture in it: the bars, the dock and Eris are the page's pixels inside the boxes the
report names. While the app window is resized the two come apart. The report for a new size arrives
a paint or more before the picture of it, and now and then the picture comes first. The motion
gate's sway (ADR 0213) counts the frames where the page's picture was laid out for another size
than the scene drawn with it (`sway-scene`): 550 of 1143 on main 4d76dcaa, 644 of 1003 with #252. In
those frames a box the report names samples the old picture where it shows something else, so the
dock and the Eris pill were drawn over a window as the app window shrank (`sway-own-pixels`, 1 to 4
frames). ADR 0211's rule, a window's frame at its picture's size, does not reach the page, which the
compositor draws as the app window.

How does every frame draw the page's picture with the scene that picture was laid out for, without a
wait in milliseconds?

## Decision Drivers

* Every frame draws the page's picture with the report it was laid out for: no bar, dock or part
  where the picture has something else
* No millisecond threshold; at rest nothing waits
* A page that never paints a report's size (off screen, stopped) still has its reports taken

## Considered Options

* Pair them by size: hold a report laid out for another size than the page's picture until a
  picture of its size comes; hold a picture of a size no report names aside until its report comes
* Pair them by sequence: the page puts its report's number into what it paints, and the compositor
  reads it back from the picture
* Draw the newest report's scene and crop or pad the picture, as before

## Decision Outcome

Chosen option: "Pair them by size", as ADR 0211 pairs a window's frame with its picture. Within a
resize every report and every picture carries the size it was laid out for, and nothing else is
needed: the page's paints carry no number, and reading one back from the pixels would cost a read
of the picture each paint.

* **A report waits for its picture** (`hosted_reports.rs`): a report laid out for another size than
  the page's last picture (to a device pixel) is held. The picture of its size takes the newest
  report held for that size; the ones before it go. A report of the picture's size is taken at once,
  so at rest, when the page changes without a resize, nothing waits. While no picture can come (none
  yet, the window off screen) a report is taken at once, and going off screen takes the newest
  held. A picture of a size no report has takes the newest held, so no report waits for a picture
  that never comes; at most 16 are held, a count.
* **A picture waits for its report** (`composed_page.rs`): a paint of a new size that none of the
  page's last 16 reports names is copied into a texture aside, whole; the page keeps its picture and
  its scene. The report naming that size makes the picture aside the page's (the two textures trade
  places) and is taken with it. A paint of the picture's own size, or of a size a report names, is
  drawn as it comes. At most 3 paints go aside in a row, a count, so a page whose reports never name
  its size still shows.
* **What the app window's edge shows**: while the page's picture trails the app window, the scene is
  laid out for the picture's size, from the top left. Where the app window has grown, past the
  scene, the desk's wallpaper shows (the compositor's fill under everything, the colour the page is
  seen through at rest); where it has shrunk, the scene is cut at the window's edge. That is how
  macOS draws a window whose content has not caught up with its frame. The bars and the dock stay
  where the picture has them until the picture of the new size comes, then move with it in the same
  frame.
* **Everything is laid out from the report taken**: the windows' places (a window that fills the app
  follows the size its report was laid out for), the input router, the edge surfaces and the parts.
  The window manager hears a held report when it is taken.

### Consequences

* Good, because no frame draws a bar, the dock or a part where the page's picture has something else,
  and a window's own pixels are not covered by a box of a scene the picture is not of.
* Good, because the pairing is decided by the sizes alone, the same at any speed and load.
* Bad, because the scene lags the app window's edge by the page's paint time while it is resized: the
  bars and the dock trail the edge by a frame or more, with the wallpaper or a cut at the edge.
* Bad, because a window that fills the app (or is maximized) takes the app's new size one page paint
  later than before: its place comes from the report taken, and its own page is sized from it.
* Neutral, because a picture aside costs a texture of the page's size while it waits, and its first
  paint is copied whole, as a paint of a new size always was.

### Measurements

The motion gate (`just perf-motion`, the optimized shell headless at scale 1, the Default profile's
13 windows; the sway grows and shrinks the app window between 1024×600 and 1624×1000 for 8 s while a
window shakes). Main is 858309f2 (3 runs, load average 3 to 8); this change is the worst of 5 runs,
twice (load average 2 to 5).

| Check | Main 858309f2 | This change |
| --- | --- | --- |
| `sway-scene`: the page's picture of another size than its scene | 337 of 1352 frames | 0 of 2309; 0 of 2304 |
| `sway-own-pixels`: a window showing pixels not its own | 3 of 30 | 5 of 50 (the pill's shadow, below); 0 of 50 |
| `sway-sizes` · `sway-settled` · `sway-painting` | 0 · none · none | 0 · none · none, both |
| `sway-fps` | 55.2 | 56.9; 56.9 |
| `sway-smooth` (#249) | 13.7 % | 13.6 %; 17.1 % (main read 13.7 and 15.4 % in earlier runs) |
| The shake (`fps`, `smooth`, `own-pixels`) | pass | pass, both |
| The loop (`loop`) | pass | pass; 1 of 5 runs failed (below) |

* **How often each half waits.** Per sway the page sent about 460 reports; 282 to 339 of them (61 to
  74 %) were held for their picture, and 0 to 2 paints went aside. Outside the sway, in the resize
  loop's jumps between four sizes, 9 to 20 pictures per run came of a size no held report had and took
  the newest held.
* **The picture aside is needed.** Without it (reports held, pictures drawn as they came) one run
  still drew 1 of 459 sway frames with a picture its scene was not laid out for: the page had painted
  a size before reporting it, 15 times in that sway.
* **The edge.** The page's picture trails the app window's edge as much as before: by a median of 78
  logical pixels and 170 at the 95th percentile here, 77 to 81 and 158 to 176 on main. What changed is
  that the scene trails with the picture instead of running ahead of it.
* **What the gate saw at first.** With the scene fixed, `sway-own-pixels` still counted 1 frame in
  each of the 5 runs, always the same moment of the sway: blocks 5 to 17 pixels from the talk pill's
  box were darker on the shaken window. That is the pill's shadow (the theme's `--desk-shadow-md`,
  0 8px 24px), drawn where it should be, outside the box the page reports. The gate now counts what
  lies over every window with that shadow's reach (`SHADOW` in `e2e/perf/lib/motion.ts`: 16 px above,
  32 below, 24 to each side); recounted on the same frames, the 5 become 0, and without the margin
  the recount gives the gate's 5 back.
* **The loop's one failure** was a plugin page, not the desk's: in the second set's first run the
  Terminal's plugin page kept one size (729×858) for 3 s while its window asked for four others, the
  maximize among them, and the stall watch loaded it again (ADR 0210's fault: CEF holds a view's next
  size until a paint at the one before). Its window's own page painted throughout. The plugin pages
  were told to catch up as often as on main (about 90 times a run for their size, 3 to 13 at their
  asks; a page went 2 s without a paint in 2 of these 10 runs and in 1 of main's 3), so this is that
  fault's tail, which this change does not touch.
* **`just perf-compositor`**, its shell probe from main 858309f2 and from this change, three runs each
  in turn (load average 2 to 4), medians: a press to its paint at p95 20.47 ms and 18.32; to its
  composed frame 20.84 and 19.58; a press at rest at p95 35.09 and 34.84; a caught press's wait 0.01
  and 0.52; the desk's start to a web surface 185.4 and 186; memory per surface 121.5 and 119.9 MB;
  at rest 10.4 wake-ups a second and 0.9 % CPU on both, and a page's own change to its paint 62.6
  and 66.1 ms (the probe has no desk page, so none of this change runs in it). Main itself reads past
  two budgets that this change does not touch (a press's composed frame, 16 ms; a press at rest, 32
  ms), as it has since ADR 0210. The compose bench (`crates/desk-compositor`) is not changed.

## More Information

Issue #269. Code: `apps/desk/shell/src/compositor_window/{hosted_reports,composed_page,page}.rs`,
`hosted.rs`, `composed.rs`, `compositor_window.rs` (`report`). Tests:
`apps/desk/shell/src/compositor_window/hosted_reports_tests.rs` and `composed_page.rs`. The gate:
`e2e/perf/motion.json` takes `sway-scene` out of `known` and `sway-own-pixels` out of `sometimes`, and
`captured` in `e2e/perf/lib/motion.ts` grows the boxes over every window by `SHADOW`. ADR 0214 (#270)
sizes a window's section by its own page; the two meet in the sway. No section of
`docs/ko/desk-structure.md` changes.
