---
status: accepted
date: 2026-11-14
decision-makers: Team endue
---

Part of ADR 0205's quality track (#232, #250). Numbered past 0206 to 0208, which other sessions hold.

# Windows rest on whole device pixels, and their pages are read texel for texel there

## Context and Problem Statement

Nothing in the compositor's draw path snapped to device pixels. A drag, a pan, a glide or a split
ratio leaves a window at a fraction of a pixel, and the surfaces in it (its own page, ADR 0201, its
plugins' pages, parts of the desk's page) were sampled with a linear filter wherever they landed. On
2026-11-13 a window dropped at (510.4, 450.6) on a 1x display stayed blurred at rest, 24 % less edge
contrast, while the compositor's own title text, set at the device's size, stayed sharp. The window's
surfaces were also square under its 12 px rounded frame, so content showed past its corners. How does
a window at rest show its page exactly as the page rendered it, at every scale, while motion stays
smooth?

## Decision Drivers

* At rest, each device pixel shows the texel the page rendered for it, at scales 1, 1.25, 1.5 and 2
* A window under the pointer or gliding moves smoothly, not a pixel at a time
* A part cut from a texture never shows the texels beside it
* What the window manager stores is what is drawn; the page and the compositor agree on places
* A window's content keeps inside its rounded frame

## Considered Options

* Rest places on whole device pixels in `desk-wm`, the compositor reading a one-to-one texture texel
  for texel at rest and filtering it on the way
* Every window drawn on whole pixels all the time: no state about motion, but a glide's slow end and
  a trackpad's pan step a pixel at a time
* Nearest sampling for every surface: sharp at rest without moving anything, but a window that moves
  shimmers as each texel jumps between pixels, and a scaled surface (a thumbnail) aliases
* Rest places on whole CSS pixels only: clean numbers, but at 1.25 and 1.5 a whole CSS pixel is not a
  whole device pixel, so the textures would still land between pixels

## Decision Outcome

Chosen option: "Rest places on whole device pixels, texel for texel at rest", because it makes the
place itself right, keeps motion filtered, and holds at fractional scales.

* **The window manager** (`desk-wm/src/pixels.rs`): `Wm` knows the display's scale. A drop, a resize
  and a keyboard step store their rect with its corner and size on the device grid; a pan it makes
  (the pointer's, the canvas map's) stores its offset there; a window's rest place (`target`) is
  rounded the same way, so a glide into a fill ends there, and so is a place the runtime's edits
  leave between pixels (a wheel's pan). A glide shorter than a device pixel does not run.
  A split's first pane takes a whole number of CSS pixels, so its divider lands on whole pixels at
  1x and 2x. Rounding is JavaScript's, half up, as the rest of `desk-wm`.
* **The shell** (`compositor_window/draw_pixels.rs`): a window at rest is drawn at its place rounded
  to device pixels (the same function), which also covers a fill or a floating window scaled with
  the app at 1.25 or 1.5. A window held or gliding is drawn where it is, its surfaces marked
  `whole_pixels: false`.
* **The compositor** (`desk-compositor/src/pixels.rs`, `shaders.wgsl`): a surface whose group maps its
  texels one to one onto the target (no rotation or tilt, a scale within 1/64 px of one texel a pixel)
  and that is not marked otherwise is moved by less than half a pixel so the texture's grid is the
  target's, its edges rounded to whole pixels, and the shader reads each pixel's texel with
  `textureLoad` from the fragment's own position: no interpolation error can pick a neighbour.
  Anything else is filtered as before, now clamped half a texel inside the part its uv cuts.
* **Corners** (`SurfaceNode::corners`): a surface takes a radius on chosen corners. A window's
  surface that reaches one of its corners takes the frame's radius there, less its inset from the
  frame's edge (11 px for a pane inside the 1 px border), so it is concentric with the border; a
  pane's top corners under the title bar stay square, a window's own page is rounded on all four.
  The focus ring round a pane (#56) follows the same corners; a shape has one radius, so the ring
  is drawn as four quarters, each clipped on whole pixels and rounded by its own corner's radius.

### Consequences

* Good, because a window at rest is as sharp as its page renders it wherever it was dropped, and
  `crates/desk-compositor/tests/whole_pixels.rs` holds that at four scales pixel for pixel.
* Good, because motion keeps sub-pixel smoothness; only the last fraction is dropped when it rests.
* Good, because the shader's change is local: shapes, text and scaled surfaces draw as before.
* Bad, because a stored place now depends on the display it was made on: at 1.25 a drop stores
  510.4. Drawn on another display it is rounded again at rest, so it stays sharp, but its number
  is not a whole CSS pixel.
* Bad, because a split's boxes now differ from the page's `flex-basis` layout by under half a CSS
  pixel; the compositor's divider and plugin surfaces cover the page's own.
* Bad, because at 1.25 and 1.5 a 1 CSS px border is 1.25 or 1.5 device pixels and stays soft on one
  edge; only textures are exact there.

## More Information

Issue #250; the motion gate's sharpness-at-rest check (#247) measures the same thing on the real app.
