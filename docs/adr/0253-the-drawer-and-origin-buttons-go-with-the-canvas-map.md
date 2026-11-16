---
status: proposed
date: 2026-11-16
decision-makers: Team endue
---

Amends ADR 0221 (what stays while a window fills the app: now the account bar alone).

# The Drawer and origin buttons go with the canvas map

## Context and Problem Statement

The Drawer button and the "back to the origin" button sat at the bottom left beside the account bar,
moved there by offsets in `system.css`, and the origin button was added to the page only while the
canvas was panned. Both are about the canvas: what was put away from it and where its origin is.
At the bottom left they crowded the account bar and the origin button was clipped; the canvas map,
which the compositor draws at the bottom right (#54, ADR 0161), is where a person looks for the
canvas. Design #291 ("Bottom right: the map and what goes with it") puts them in a strip under the
map with the desktop's name. ADR 0221 kept the Drawer button in sight while a window fills the app.

## Decision Drivers

* The canvas's controls are where its map is; the bottom left is the person's (the account bar)
* Both buttons always reachable: with the map folded, and the origin button never appearing and
  going as the canvas pans
* The compositor's map is not moved or resized: no change to `draw_map.rs`, no new motion to gate
* Map and strip read, and move, as one

## Considered Options

* A page strip under the map the compositor draws, as wide, filling the 32 under its box
* The compositor draws the buttons itself, in the map's card
* Move the map down to 16 from the bottom and lay the strip over it

## Decision Outcome

Chosen option: "a page strip under the map", because the buttons stay the page's own controls (the
drawer's panel, its tooltip, the keyboard, a plugin taking `role:dock`) and nothing of the
compositor changes.

* **Where** (`packages/runtime/src/shell/MapStrip.ts`, `scale.css`): `.map-strip`, mounted by
  `mountBottom` after `footer.bottom` in the dock role's root: 202 wide (the map's 192 and its 5 of
  padding on each side), 32 high, its bottom 32 above the app's, its right 24 from the app's, 92 in
  an app under 734 high, as `draw_map.rs` places the map. The card is the bars' card, its bottom
  corners the map's; its top border is the map's own while the map is unfolded.
* **What**: the desktop in front's own name, else "Desktop 2"; the Drawer button with its count,
  whose panel opens above the strip, its right edge on the strip's; the origin button, disabled,
  not removed, while the canvas is at its origin.
* **The compositor**: `desk.canvas` is the strip's box (`compositor-system.ts`); the report's
  `map.shift` and `map.away` are the strip's (`compositor-desk.ts`), the rail's only where the page
  has no strip.
* **While a window fills the app** (`away.ts`): the strip goes past the right edge with the rail
  and the map with it; the Drawer's panel open keeps the right edge in sight. The account bar alone
  stays at the bottom left (amends ADR 0221).
* **The running chips** move left to clear the strip, 12 past it, and keep 16 past the talk pill
  at rest; the pill under the pointer is drawn over them. The open talk line reaches 12 before the
  strip, so while it is open the chips rise above it.

### Consequences

* Good, because the bottom left holds the account bar alone, and the origin button is never clipped
* Good, because the map and its controls are one card the person finds in one place
* Good, because nothing under `crates/` or the compositor changes: the motion gate is not touched
* Bad, because while a window fills the app the Drawer is out of sight with the rail until the
  pointer comes to the right edge
* Bad, because the strip's place copies the compositor's numbers (`draw_map.rs`' RIGHT,
  RIGHT_SHORT, TALL, BOTTOM, PAD and `desk_wm::MAP`): a change there must change `scale.css`
* Bad, because the running chips have less room at the right (98 px in a 1024 × 500 app), the
  pill under the pointer covers them, and they rise over the windows while the talk line is open

### Confirmation

`packages/runtime/src/shell/MapStrip.test.ts`, `Drawer.test.ts`, `Pan.test.ts`, `away.test.ts`,
`apps/desk/src/compositor-system.test.ts`, `compositor-desk.test.ts`; painted in
`packages/runtime/e2e/shell-canvas.spec.ts`, `shell.spec.ts`, `account-bar.spec.ts`,
`shell-away.spec.ts`, `shell-sizes.spec.ts` and `shell-a11y.spec.ts`.

## Pros and Cons of the Options

### The compositor draws the buttons

* Good, because one card drawn by one hand
* Bad, because the drawer's panel, the tooltip and the keyboard are the page's: the compositor would
  hand every press back, and a change to the compositor is gated by `just perf-motion`

### Move the map down

* Good, because the strip could sit 16 from the bottom as the bars do
* Bad, because it changes `draw_map.rs`' `BOTTOM` and the map's motion, which this change need not

## More Information

Issue #296, design #291, ADR 0161 (the canvas map), ADR 0221 (the chrome while a window fills the
app).
