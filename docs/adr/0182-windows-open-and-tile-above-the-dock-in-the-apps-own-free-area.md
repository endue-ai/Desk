---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0040 (the free area plugin windows are tiled in is the app's own as it was when each
window arrived, above the dock) and ADR 0116 (Tile, Cascade and the spread keep clear of the dock).

# Windows open and tile above the dock, in the app's own free area

## Context and Problem Statement

A plugin window no profile places opens in a slot of its own (ADR 0040): six slots of one size fill
the free area three by two, and the next six cascade over them 32 px down and right. `desk-wm` laid
the slots in the free area of the 1440×900 reference frame whatever the app's size, and that free
area ended 88 px above the bottom, where the drawer button, the composer and the running chips end.
The dock's band starts 100 px up: the bottom edge's 72 px over the status line's 28 px track. On
the app's first size, 1280×800, every start put Database, Explorer, Notes and Plugins at x 932 and
964, 402 px wide, their close, drawer and pin tools past the right edge, and the second row at y 507
and 539, 305 px tall, its lower third under the dock (QA of 2026-11-11, #158, #159, #160, #162). A
window opened from the dock later landed at 996,254, under the rail. Tile laid its last row to
y 713 over a dock that starts at 701, and the spread its front row of cards under the dock's tiles.
Where do new windows open, and what do the arrangements fill?

## Decision Drivers

* Every window a desk opens by itself has its title bar and its tools in sight, at any app size
* A window never moves or resizes because another one arrived, or because the app resized: a normal
  window lives on the canvas
* Slots, Tile, Cascade and the spread keep clear of the same bars
* No new protocol: the runtime keeps sending `adopt` with a plugin id and a title

## Considered Options

* Lay each window's slot in the app's free area as it was when the window arrived, and end the free
  area above the dock
* Lay the slots in the app's free area as it is now, so slot windows follow every app resize
* Keep the reference frame's slots and map them onto the app as floating windows are

## Decision Outcome

Chosen option: "the app's free area as it was when the window arrived, above the dock", because it
opens every window inside the app without moving one that is already there.

* **Above the dock.** The free area (`geometry::free_area`) ends `DOCK_BAND`, 112 px, above the
  app's bottom: the dock's 100 px and the 12 px gap the slots keep. Tile and Cascade fill it; the
  spread's stage keeps the same band, and its rows leave room for the front row's outer cards,
  which dip 8 % of a row. The bars' bands (`SAFE`) and the floating windows' mapping do not change.
* **The area at arrival.** `adopt` records the free area of the app at that moment (`Adopted.area`,
  under Eris while she is at home); the slot is laid in it. A window handed over again keeps its
  slot, its pan and its area. One whose plugin was turned off and on again arrives anew and opens in
  the app as it is then. A session restored at start keeps each window's slot and pan, laid in the
  area of the start's app.
* **The cascade inside the area.** The room for two cascading sixes (64 px each way) is kept inside
  the area, so the third six ends at its right and bottom edges and the nineteenth starts over the
  first. A cell under the minimum window (240×160) keeps the minimum, and the cells overlap then
  rather than leave the area.

### Consequences

* Good, because at 1280×800 the Default profile's fourteen windows lie between the agent bar and
  the rail and above the dock, every title bar's tools in sight, and Tile and the spread stop at the
  dock.
* Good, because a window keeps its place through an app resize, as every normal window does.
* Bad, because the first window size is smaller: 328×211 at 1280×800 and 381×261 at 1440×900, where
  it was 402×305 (cut off) at both. Plugins whose first size was judged at 400×263 meet 326×169.
* Bad, because windows that arrived before and after an app resize sit on two different grids and
  may overlap more than one grid would.
* Bad, because the dock's height is a constant here: a display rule that gives the bottom edge more
  than 72 px, or a desk without the dock, still keeps the 112 px band.

## More Information

Code: `crates/desk-wm/src/{geometry,tiling,edits,types}.rs`, `desk/edit.rs`, `spread/slots.rs`.
Tests: `crates/desk-wm/tests/first_layout.rs`, `e2e/specs/windows-first-layout.spec.ts`. The scene
vector's put-away window (`specs/bridge/v0/vectors/valid/desk-windows-list-scene.json`), the
runtime e2e's slot, tile, cascade and terminal-fit numbers, the shell's draw tests and the
compositor's spread snapshots follow the new geometry. No section of `docs/ko/desk-structure.md`
changes.
