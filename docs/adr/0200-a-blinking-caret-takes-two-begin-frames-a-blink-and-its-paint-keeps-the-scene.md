---
status: proposed
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0185 (a lone paint keeps a surface on ten slow frames a second) and ADR 0161 (the
canvas map's thumbnails drawn again at every frame that lays the scene out).

# A blinking caret takes two begin frames a blink, and its paint keeps the scene as it was laid out

## Context and Problem Statement

R1, today's final run: `e2e/perf/rest.perf.ts` (a fresh desk at rest, its own process's CPU, 5 %
at most, recorded at 3 %) read 1.0 to 1.6 % up to #195 and 17.0 % at #196 (A7). One of A7's commits
gives the Terminal on screen the keys its window gets at a fresh start, so a fresh desk has a
focused terminal and its cursor blinks: xterm's DOM renderer runs a CSS animation, `1s step-end`, a
lone paint every 500 ms. Chromium's text carets (Notes, the palette, the talk line) blink the same
way, on a 500 ms timer of the page's own. ADR 0185 keeps a surface with lone paints on ten slow
frames a second; C28 took the desk from 17 % to 10.9 %, and main with P2 read 12.4 to 14.7 %.

Measured on the stack this lands on (b3d01147), 13 windows, the Terminal focused, the screen locked:
the main process at 11.4 to 14.7 % of a core, 2.0 paints and 9.9 begin frames a second, the event
loop at 61 to 67 turns a second; with the cursor's animation turned off, 2.1 %. A profile of 10 s
(`sample`) put 438 of the main thread's 758 busy samples in `CompositorWindow::compose`: each blink's
paint laid the whole scene out again (every window's chrome, the system layer's page parts, the
canvas map and its thumbnails), 30 to 40 ms of the debug build's main thread, and CEF's work took
113. The begin frames were the smaller part: ten a second against two cost 3 to 5 points, the
layout 8 to 10. How does a desk with a focused, blinking caret cost no more than one at rest, the
caret still blinking evenly and typing still instant?

## Decision Drivers

* `rest.perf.ts` within its 5 % with a focused terminal, near its recorded 3 %
* The caret blinks visibly and evenly; a press or a key still paints at once (ADR 0157's prompts)
* A fix that every surface's lone paints share, not one for the Terminal
* A7 stays: the Terminal still takes the keys at a start
* No patch to CEF or Chromium (ADR 0157)

## Considered Options

* (a) Pacing that follows a lone paint's rhythm, on its own or with (d)
* (b) Begin frames only when the renderer asks for one
* (c) The caret blinks only while the app window has the OS focus, and stops after a long idle
* (d) A frame for which only surfaces' pictures changed draws the scene as it was laid out

## Decision Outcome

Chosen options: "(a)" and "(d)", because together they take a blinking caret's cost on a fresh
desk from about 11 points of a core to about 2 and lower what every surface's lone paints cost,
while the blink and the prompts stay as they were.

* **The rhythm** (`web_host/frames_rhythm.rs`, used by `frames_pacing.rs`): once three lone paints
  came on slow frames the same time apart (between 250 ms and a second), the slow frames after each
  paint skip ahead to one slow period before the next is due. A 500 ms blink takes the slow frames
  400 and 500 ms after the frame that painted it, then the slow frames again until a paint: four
  begin frames a second for two paints, where ADR 0185 sent ten. The blink still meets the first
  slow frame after it, as on the slow frames alone, so it keeps its moment each time. Each paint
  sets where the next two frames are (the gap it came after is the rhythm's period from then on):
  a period the slow frames cannot measure (530 ms meets frames 100 ms apart 500 and 600 ms apart)
  never walks the frames away from the blink, and two blinks never merge into one paint, which a
  single frame a blink at a fixed period did whenever the period measured long. A blink further
  from its time than a slow period, or a paint on another frame (input, a page's ask, every frame
  while it paints), starts the learning again. Resting is ADR 0185's: a second and ten slow frames
  after the last paint.
* **A frame of pictures alone** (`compositor_window/composed.rs`, `compose.rs`): a surface's frame
  of the size its texture had changes only its picture (`Composed::repainted`); the next frame
  draws the scene as it was laid out. The scene samples each surface's texture by its id, so the new
  picture shows without laying anything out. A surface's first frame, a new size, the desk's page's
  frames (its paints place the windows' page parts, `PageShown`) and every change of the desk's
  still lay it out (`Composed::dirty`), and a press still lays out a scene that is due first (#139).
* **The map's thumbnails** (`minimap.rs`): a frame of pictures alone draws a surface's thumbnail
  again once that surface's frames changed a 32nd of its pixels since its thumbnail was drawn
  (`Composed::unmapped`): a caret's blink changes a few hundred pixels of a window's hundreds of
  thousands, too few to see at the map's scale; a page of new text or a video's frame passes it at
  once. Every frame that lays the scene out draws them all, at most ten times a second, as before.

### What the measures found (macOS 26, M4 Max, debug build, the screen locked, load average 1.6 to 3)

* `rest.perf.ts` (`PERF_MODE=check pnpm exec wdio run e2e/perf/wdio.conf.ts --spec
  e2e/perf/rest.perf.ts` after `just build-shell`): b3d01147 12.4 %; the Terminal's cursor not
  blinking (`cursorBlink: false`, a measure only) 1.2 %; the rhythm and (d), 4.4, 4.6, 4.4 and 4.7 %;
  with the map's thumbnails drawn for a frame of pictures alone only once much changed, and the
  spread's tick and the popups' screens no longer costing each wake-up (two small changes beside
  this one), 3.4, 3.6, 3.5 and 3.7 % in four runs in a row.
* The harness's desk (13 windows, the Terminal focused): b3d01147 11.4 to 14.7 %, the Terminal 9.9
  begin frames a second for 2.0 paints and the loop 61 to 67 turns a second; (a) alone (two slow
  frames a second, a measure only) 8.4 to 9.0 %; (d) alone 3.3 to 3.9 %; both, 2.4 to 2.9 % in quiet
  windows of 10 s, the Terminal 3.9 to 4.0 begin frames a second for 2.0 paints and the loop 41 to 45
  turns, against 1.1 to 1.4 % with the cursor's animation off. That desk also has bursts of 5 to
  12 % for tens of seconds a minute or so after its start, CEF's work at 100 to 170 calls a second
  with no frame or paint more, the cursor's animation on or off: not this change's.
* One begin frame a blink instead of two (a measure only) read 2.4 to 2.5 % where two read 2.9 in
  the same quiet windows; the second frame is what keeps a period the slow frames measured long
  from walking the frames off the blink.
* `just perf-compositor`, b3d01147 and this change: every gate within its budget but one, a press on
  a desk at rest 2 s or more, p95, 24.49 ms (blocks 24.49, 16.38, 24.52) and 17.4 ms (17.4, 16.26,
  24.52) against 16; a press to its composed frame 16.04 and 15.26 ms at the median; the probe's
  desk at rest 10 and 10.1 wake-ups a second, no begin frame, 1.3 and 0.8 % CPU. The probe has no
  caret and its desk rests, so that gate's misses are not this one's: alone, b3d01147 read 16.55 ms,
  with ADR 0185's pacing taken back 17.23 and without ADR 0165's switch 17.33, and ADR 0165 found
  it over its budget both ways on the same machine the night before. Press by press, in three runs,
  the second click page's presses painted 14 to 17 ms after them in each, the first's 7 to 8 in
  two of them: left for a follow-up of its own.

### Consequences

* Good, because a focused field's caret costs a desk at rest about two points of a core where it
  cost eleven, and its blink keeps its moment.
* Good, because every frame of pictures alone is cheaper: a page's own animation, a video and a GIF
  no longer lay the desk's scene out at every frame, and a press after a blink lays out nothing.
* Bad, because a change between two blinks that the page cannot see to ask for (a CSS animation's
  step on the same surface) waits for the blink's frames, up to the period less a slow frame, where
  it waited a slow frame at most.
* Bad, because the earlier of the two frames is spent on nothing while the blink keeps its period;
  a single frame a blink cannot tell a period measured long from one measured right.
* Bad, because a thumbnail of a surface that changed little stays as it was until a frame lays the
  scene out or the changes add up to a 32nd of it.
* Bad, because anything that changes the scene must say so (`dirty`): a surface's paint no longer
  lays the scene out for it.

### Not chosen

* (b): CEF 156 has `external_begin_frame_enabled` and `SendExternalBeginFrame` and nothing that says
  a renderer wants a frame (its render handler has no such call); `frame_asks.js` sees what a page's
  scripts do, and neither a caret's timer nor a CSS animation's step is one.
* (c): its first half holds already: told its window lost the OS focus (`windowFocused: false`),
  the harness's desk sent the Terminal no begin frame, its page's focus gone and its cursor still.
  The second half is a product change the frame clock cannot make: Chromium has no blink timeout,
  so it would take a script in every page setting `caret-animation: manual` after a while without
  input, and the Terminal's own `cursorBlink` (xterm's DOM renderer blinks with a CSS animation the
  caret property does not reach). Left for the person.
* (a) alone: ten slow frames a second to two (a measure only) took the harness's desk from 11.4 to
  14.7 % to 8.4 to 9.0 %: the layout at each paint was most of the cost.

## More Information

R1 (the 2026-11-12 final run). Amends ADR 0185 and ADR 0161. Code: `apps/desk/shell/src/web_host/
frames_rhythm.rs`, `frames_pacing.rs`; `apps/desk/shell/src/compositor_window/composed.rs`,
`compose.rs`, `minimap.rs`, `clock.rs`; beside it `compositor_window/spread.rs` and
`web_host/popup_screen.rs` (a wake-up's own cost). Tests: `web_host/frames_slow_tests.rs`,
`compositor_window/composed_tests.rs`, `compositor_window/minimap.rs`'s, `e2e/perf/rest.perf.ts`, `tests/budgets.rs` through `just
perf-compositor`. No section of `docs/ko/desk-structure.md` changes.
