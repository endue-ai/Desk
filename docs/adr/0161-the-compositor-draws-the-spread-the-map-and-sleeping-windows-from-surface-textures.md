---
status: accepted
date: 2026-11-11
decision-makers: Team endue
---

# The compositor draws the spread, the canvas map and sleeping windows from surfaces' textures, and any surface's snapshot is a bridge call

## Context and Problem Statement

Since #53 the compositor draws every window from `desk-wm` (ADR 0156, ADR 0158), and the page no longer
holds DOM windows a stylesheet could pose. Three features of the page went with that or drew around it:
the spread (ADR 0116), which posed the DOM windows in 3D and was removed by #83 until the compositor
draws it; the canvas map (ADR 0082, `shell/Minimap.ts`), which drew windows as grey boxes in the page;
and the sleeping placeholder (ADR 0134), a card in place of the window's content. ADR 0140 promised that
a snapshot of any window is free once its texture is the compositor's. How do these draw on the
compositor, how do their motions stay testable at fixed times (ADR 0013), and who may read a surface's
pixels (#54, epic #32 §5)?

## Decision Drivers

* Live content: the windows' own textures, not placeholders, wherever the desk shows a window
* ADR 0116's behaviour unchanged: the fan, the camera, the selection, the filter, the keys, the motions
* Motion on an injected clock, so tests freeze it and see the same frame every run
* Drawn in the compositor, not the page: the page is a system surface now (ADR 0160), and keeps only
  its system layer
* One caller rule for every bridge call (ADR 0012): a plugin acts only as itself

## Considered Options

* The compositor draws them from the surfaces' textures: the spread as poses on the window
  manager's clock, the map from downscaled copies, a sleeping window from its kept last frame;
  `ui.surface.snapshot` under `ui:surface`
* Keep the page's chrome for the spread (its field and list) over the compositor's cards
* Snapshots as a capability of their own (a new `ui:snapshot` permission)

## Decision Outcome

Chosen option: "the compositor draws them from the surfaces' textures", because the textures are
already the compositor's, every piece then has one owner, and the page draws none of it.

* **The spread** (`desk_wm::spread::run`, the shell's `spread.rs` and `draw_spread.rs`). `Spread` is
  the runtime's controller without a view: it opens from where the windows are over `--motion-slow`,
  moves over `--motion-fast` on a key, the filter or the pointer, pans and zooms at once, and closes
  over `--motion-base`, on the window chosen or on none; times are the caller's milliseconds.
  `desk.windows.spread` (Mod+Alt+S, the strip's Spread button) asks the window manager's host
  (`Op::Spread`), which on the compositor opens or closes it; desk-wm alone changes nothing for it.
  While it is open it hears the pointer and the keys first; chords go on to the keymap. Each window is
  drawn whole (its chrome, what the page draws of it, its surfaces) in a group at its pose, under a
  perspective camera (`desk_compositor::stage`: CSS's 1800 px at 50% 45%, z and the turns flipped to
  the compositor's axes); the scrim, the field, the count, the hint and the empty message are
  `Chrome`'s parts with #51's text. Under the scrim the system layer is drawn as ADR 0160 stacks it
  (the edge bars, the page outside the windows and its named parts, the overlays), taking no pointer. Covered windows' surfaces are shown while it is open, so every card
  is live; a sleeping one stays asleep and shows its last frame. Picking pans the window into sight
  (`reveal`) and, once the cards are home, runs `desk.windows.focus`. For assistive technology the
  spread is a modal dialog whose combobox has the keyboard over a listbox of the titles.
* **The canvas map** (the shell's `minimap.rs` and `draw_map.rs`). Its rules are desk-wm's
  (`map_shows`, `fill_in_sight`, `MapDrag`), its look `Chrome`'s, its place the stylesheet's. Each
  window is drawn from thumbnails of its plugin panes: `desk_compositor::Thumbnails` halves a texture
  pass after pass to the size asked for (a box filter), drawn again at most ten times a second and only
  when its source changed. A press takes the view there, a drag moves it with the fit the press held,
  Escape puts it back, the wheel pans; its button folds it, and the page keeps that with the session
  (`desk://compositor-map`). `shell/Minimap.ts` and its model are deleted.
* **Sleeping windows.** The compositor already kept a surface's last texture when its process went
  (ADR 0151); a sleeping window draws it greyed (`SurfaceNode::grey`) under a lighter veil
  (`Chrome::sleeping_card`) with Reload, which runs `desk.frames.reload`. That command now wakes a
  sleeping frame as well as a stopped one, and the page's placeholder offers the same button.
* **Snapshots.** `ui.surface.snapshot { plugin, surface?, maxWidth?, maxHeight? }` answers the
  surface's frame as a PNG with its size, its scale and whether it sleeps (`specs/bridge/v0/ui.schema.json`).
  It needs `ui:surface`, whose description now says so, rather than a new permission: a plugin
  snapshots only its own surfaces, as ADR 0012's caller rule gives it no other identity, and that is no
  more than it already draws. A caller without a manifest (the runtime `desk`, through which Eris sees,
  an agent, `cli`) snapshots any surface; the runtime and the CLI hold `ui:surface` from the start, and
  an agent asks for it as for any scope (ADR 0072). The core keeps no pixels: the shell hands it a
  `SurfaceSnapshots` while its compositor runs; without one the call answers `unsupported`.
* **Fixed times.** Every motion runs on the window manager's clock. Headless tests drive desk-wm's
  spread at 3.0 s, 8.8 s and 19.3 s and compare the composed frames (`tests/spread_snapshots.rs`); the
  app e2e holds the shell's clock (`compositor_clock`, development builds) and reads the poses and the
  composed frame there.

### Consequences

* Good, because the spread, the map and a sleeping window show the windows' own pixels, live where the
  surface paints, and the page draws none of them.
* Good, because ADR 0116's spread is back with its key and button, and its motions are deterministic
  at any time a test chooses, headless or in the app.
* Good, because Eris, agents and tests can see a window's content without a screen capture or the OS's
  permission, and a plugin cannot see another's.
* Bad, because opening the spread shows covered windows' surfaces, which paint for as long as it is
  open, and a scene in perspective has no depth buffer: cards are painted in the spread's order.
* Bad, because the compositor has no blur: the scrim darkens the desk but does not blur it.
* Bad, because the map's keys (arrows, Home) and its group for assistive technology did not come
  over: the compositor's chrome is not in the keyboard's focus order. The palette and agents still
  move the canvas.
* Bad, because a snapshot copies the frame through the GPU and encodes a PNG on the shell's thread:
  about a frame's time for a large surface.

## More Information

Issue #54 (epic #32 §5). Amends ADR 0116 (the spread's drawing, its controller in desk-wm, its key and
button back), ADR 0082 (the canvas map on the compositor), ADR 0134 and ADR 0151 (a sleeping window's
placeholder) and ADR 0012 (the caller rule, for snapshots). Code: `crates/desk-wm/src/spread/run.rs`,
`crates/desk-wm/src/minimap.rs`, `crates/desk-compositor/src/{stage,thumbnails}.rs`,
`crates/desk-compositor/src/chrome/{spread,map}.rs`, `crates/desk-compositor/src/a11y/spread.rs`,
`crates/desk-core/src/core_snapshots.rs`, `apps/desk/shell/src/compositor_window/{spread,minimap,
snapshots,draw_spread,draw_map,draw_pane}.rs`, `packages/runtime/src/arrange/`,
`packages/runtime/src/frames/{install,placeholder,commands}.ts`. Tests:
`crates/desk-wm/tests/spread_run.rs`, `crates/desk-compositor/tests/{spread_snapshots,thumbnails}.rs`,
`crates/desk-core/tests/ui_snapshot.rs`, `compositor_window/draw_spread_tests.rs`,
`e2e/specs/windows-{spread,map}.spec.ts`. No section of `docs/ko/desk-structure.md` changes.
