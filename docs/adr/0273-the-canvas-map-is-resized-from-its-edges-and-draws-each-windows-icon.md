---
status: proposed
date: 2026-11-18
decision-makers: Team endue
---

Amends ADR 0161 (the canvas map's windows) and ADR 0253 (the strip under the map). ADR 0082 still
holds for what the map shows and how it moves the view.

# The canvas map is resized from its edges and draws each window's icon

## Context and Problem Statement

The compositor draws the canvas map in the bottom right, 192 by 120 CSS pixels (`desk_wm::MAP`).
Every normal window in it is drawn from downscaled copies of its panes' surfaces (ADR 0161). They are
redrawn at most ten times a second, from every frame that changed a 32nd of a window (ADR 0200). At
the map's scale a window is a few dozen pixels on a side, so its content reads as a smudge. A person
finds a window by its kind (the terminal, the mail, the notes), and the smudge does not say which.
The box's size suits a laptop, but it is small on a large display and in the way on a small one.

How does the person tell the map's windows apart, and set how large the map is?

## Decision Drivers

* A window in the map reads as what it is at a glance, at any size the map takes
* One icon per window, the same one its title bar shows, from one set of icons
* The map keeps its place: against the app's bottom right, under the right rail where it fits
* The strip under the map (ADR 0253) stays as wide as the map, whatever its size
* No new frame work: the map should cost less while the desk paints, not more

## Considered Options

* Each window's icon in its box, drawn by the compositor from the runtime's icon paths
* Thumbnails kept, the icon drawn over them
* The page draws the map's icons in its own layer, over the compositor's map

## Decision Outcome

Chosen option: "each window's icon, drawn by the compositor from the runtime's icon paths", because
it says what a window is at the map's scale and needs no copies of surfaces.

* A window's icon is the one its title bar shows: the view's (`viewIcon`), a built-in plugin's own
  (`shell/plugin-icons.ts`), else the box. The page reports each view's icon as SVG path data on the
  24 grid of `shell/icons.ts` (the report's `icons`). The compositor strokes it 2 units wide with
  round caps and joins, as the page's SVG does, with zeno: swash, cosmic-text's rasterizer, already
  builds it. The icon is drawn once per path, size and colour into a texture (`desk_compositor::Icons`)
  and let go once no window shows it. It is centred in the window's box, half its shorter side and at
  most 28 px. The focused window's icon is drawn in the accent, the others in the icon colour.
* The thumbnails, their ten-a-second refresh and the changed-pixel count (ADR 0200's 32nd) leave the
  map. A frame of pictures alone no longer touches it.
* The person resizes the open map from bands along its left and top edges and the corner between
  them. It keeps the frame's proportions, and its bottom right stays where it was. Its canvas is 144
  to 480 wide (`desk_wm::map_size`, `map_resized`); Escape puts back the width the press found. A box
  too tall to keep the rail 12 px above it goes left of the rail's column, as in an app under 734 px
  high. That height is now 2 × (64 + the box's height + 12 + 161) (`draw_map.rs`' `tall`).
* The shell tells the page each new width (`desk://compositor-map`). The page keeps it with the
  session (`mapWidth`) and reports it back. The strip under the map takes it as `--map-width`, and
  `scale.css` derives the rail rule from it.

### Consequences

* Good, because every window in the map says what it is, at 0.75 to 2.5 times the old size.
* Good, because the map draws no copies of surfaces, so a desk that paints does no work for it.
* Good, because the title bar's icon and the map's come from one table, and a built-in plugin's
  window shows its own icon in its title bar instead of the box.
* Bad, because a community plugin's window shows the box until manifests can name an icon; that
  needs a field in `specs/plugin` and is left for later.
* Bad, because the map no longer shows what a window holds; the spread (ADR 0116) still does.

### Confirmation

`crates/desk-wm/tests/map_size.rs` (bounds, proportions, each grip's edges). `desk-compositor`'s
`icons.rs` (stroke width, round caps, premultiplied colour) and `tests/icons.rs` (one texture per
path, size and colour, swept once unused, drawn in its colour on the GPU). The shell's
`draw_map_tests.rs` and `draw_spread_tests.rs` (size and place, the rail rule, icons centred in their
windows, the grips before the canvas and the fold button before the grips). `plugin-icons.test.ts`,
`MapStrip.test.ts`, `link.test.ts` and `apps/desk/src/compositor-desk.test.ts` (every windowed
built-in plugin has its own icon, the report's icons and width, the strip and the session following
it). On the CEF desk: `e2e/specs/windows-map.spec.ts` (an icon in Notes' window, a resize from the
corner and Escape).

## Pros and Cons of the Options

### Thumbnails kept, the icon drawn over them

* Good, because the content stays for a person who reads it
* Bad, because an icon over a smudge reads worse than an icon alone, and the refresh stays

### The page draws the map's icons in its own layer

* Good, because the page already draws SVG icons
* Bad, because the page would have to follow the compositor's map frame by frame during a pan or a
  drag, which the compositor draws ahead of the page (ADR 0153)
