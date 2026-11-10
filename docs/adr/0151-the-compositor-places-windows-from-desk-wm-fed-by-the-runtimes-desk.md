---
status: accepted
date: 2026-11-10
decision-makers: Team endue
---

Status: amended by ADR 0153: in compositor mode `desk-wm` runs the window gestures on the
compositor's input and publishes each change, which the runtime takes as the truth for geometry.
Amended by ADR 0156: compositor mode is the only desk; the page always publishes its desk, and the
runtime has no window manager of its own for gestures and commands.
Amended by ADR 0158: `desk-wm` holds the desk; the page's report carries no desk any more, and the
live set reaches the runtime through its window manager host (`WindowManagerHost.live`).
Amended by ADR 0160: the page's report names each surface's document from the runtime's surface pages
(no frame in the page), each plugin surface of its own with its layer (an edge bar under the page's
parts, an overlay above them) and the parts of its system layer, which the compositor draws whole above
every window; the Bad consequence "the page is one picture" holds now only where a part's box ends.
Amended by ADR 0161: a sleeping window shows its surface's last frame greyed under its card, with
Reload (`desk.frames.reload`).

# The compositor places windows from desk-wm, fed by the desk the runtime keeps, and keeps the live budget

## Context and Problem Statement

In compositor mode (ADR 0149) the shell page reported where each plugin frame sat in its DOM and what
covered it, found by hit testing a grid, and the compositor drew each surface over the page there.
`desk-wm` (#78, #79) now holds the window manager as a model with the runtime's behaviour and numbers,
and both answer `desk.windows.list` alike (#82). #81 makes the compositor host the windows: the bars'
geometry and the free area, each window at its rectangle with chrome the compositor draws in the
theme in force, each surface told its size, scale and visibility, no reload on a split, the drawer
or a desktop switch, and the live budget's sleeps with placeholders the compositor draws. Until #83
the runtime's window manager still runs in the page and owns every change. How does the compositor
take its placements from `desk-wm` while the runtime is still the one that changes them?

## Decision Drivers

* One source of truth for placement on screen: `desk-wm`, the code #83 keeps
* No second window manager to keep in step: the runtime's state goes over whole, not re-derived
* The runtime, the SDK and the plugins unchanged in behaviour; the stand-ins and the bridge as in
  ADR 0149
* A surface keyed by its host, never by where a frame sits in the page
* The live budget decided where the renderers are (ADR 0142), carried out where the state is kept

## Considered Options

* The runtime publishes its desk; the shell mirrors it into `desk-wm`, which plans what is drawn
* Keep the page's report of frame rectangles and draw chrome around them
* Move the window manager's state into the core now and have both read it there

## Decision Outcome

Chosen option: "the runtime publishes its desk", because it puts placement in `desk-wm` today with
one small, whole message, and #83 only changes who writes the state.

* **Seam, runtime to shell.** In compositor mode the page sends `compositor_desk` on each frame the
  desk changed (`apps/desk/src/compositor-desk.ts`): the store's window manager part as
  `desk_wm::Desk` reads it (`wmDesk`: each desktop's layout as drawn, the profile already layered,
  the session folded in), each plugin frame's surface host, document, load count and state (live,
  asleep, late, stopped) with what its window says while it has no live frame, the titles of the
  shell's own views, the top chips' edges (ADR 0132's clearance) and the two budget settings.
* **Plan.** The shell mirrors it (`compositor_window/hosted.rs`) and `Desk::host_plan` gives the
  windows of the desktop in front back to front, each at its rectangle with its panes' boxes, the
  plugins in sight (ADR 0070's cover), the bars' bands and the free area (`desk_wm::host`).
* **Drawing.** The compositor draws the wallpaper (the theme's background colour), then each window
  back to front: its frame, border, shadow and title from `Chrome` in the look
  `Core::watch_theme_tokens` brings, each plugin pane its surface's texture at the pane's body, and
  what the page draws of the window at its place in the stack (the title bar's icon and tools, the
  shell's own views such as the launcher, the headers of split panes), in the window's fill so what
  lies under it in the page stays hidden; then the plugin surfaces the page lays out itself (overlays,
  edge bars) and the page's system layer above every window, but for what the page draws of a window
  under another and the titles' text. The page renders see-through: its wallpaper is not drawn, its
  windows' frames, titles and placeholders keep their place for the pointer but paint nothing
  (`compositor.css`). The DOM report and its grid of hit tests are deleted.
* **Surfaces.** `desk_wm::host::Surfaces` turns the frames into protocol steps keyed by surface host:
  `create`, `resize` with the pane's size and the window's scale, `hide` and `show` for sight, `sleep`
  and `wake` as the runtime takes a frame away and puts it back, `destroy` when it lets the plugin go.
  A frame that moved in the page (a split, the drawer, a desktop switch) loads nothing again: the
  relay says the page's hello again to the moved stand-in and keeps the runtime's answering init
  (`web_host/relay.rs`). Only a new document (hot reload) loads, and a dead surface wakes when the
  runtime loads it again (#44).
* **Live budget, shell to runtime.** `desk_wm::host::LiveBudget` decides from the plan: the windows
  in sight, the one with the keys and the N most recently focused out of sight keep a renderer, and
  one out of sight for `desk.display.unload-after` sleeps. The shell sends the set
  (`desk://compositor-live`); the runtime's frame policy then decides nothing (its budget 0, the set
  as what is "in sight", a frame loading for an answer kept ten seconds) and carries the set out:
  asking for `desk:state`, taking the frame away and putting it back with that state. A window the
  runtime woke for an answer comes back live without the set: the budget counts it as the most recent.
* **Placeholders.** Asleep, stopped, crashed and not yet painted windows show a card the compositor
  draws (`Chrome::card`): the page's own words for it, read from its placeholder, and Not responding
  over the last frame with Wait and Stop.
* **Input (#56, ADR 0150).** Every node that shows a surface is the input router's target for it: a
  plugin's quad, and each piece of the page (an unseen one under everything, the parts it draws of a
  window, its layer above them, which takes the pointer only outside windows). The compositor's own
  chrome and cards let the pointer through to the page, whose window manager still moves, resizes and
  focuses windows from it until #80; the focus ring goes round the focused plugin's pane.

### Consequences

* Good, because every window the compositor draws is placed by `desk-wm`, chrome and content in one
  order: nothing above a frame has to be found by hit testing, and a menu or a bar over a window is
  simply drawn above it.
* Good, because a split, the drawer and a desktop switch never reload a plugin (ADR 0040's bad
  consequence goes in compositor mode), and the stand-ins cost no reload of their own surfaces.
* Good, because #83 removes the page's half of the seam (the report and the frame policy's carrying
  out) and keeps the shell's.
* Bad, because the state crosses as JSON on every change, and the page and `desk-wm` must lay a
  window out alike for a shell view's pixels to land in its pane (both follow the same CSS numbers;
  `tests/host.rs` and the runtime's tests pin them).
* Bad, because until #80 the pointer still works the page's unpainted windows: a drag moves the
  window only when the runtime writes the store, the cards' buttons are drawn where the page's are
  not, and spread visuals (#54) and the snap preview are not drawn by the compositor yet.
* Bad, because the page is one picture: a bar or a menu over a window that lies over another
  window's part the page draws is hidden by the upper window there, until system surfaces (#55) give
  the system layer a surface of its own.
* Bad, because the theme's backdrop image, its `.woff2` fonts and the wallpaper effects are not in
  the compositor's look yet (ADR 0146), so compositor mode shows the theme's background colour.

## More Information

Issue #81 (child 4 of #53, epic #32 §5 and §8). Builds on ADR 0149 (off-screen surfaces, whose
"Places" it replaces), ADR 0134 and ADR 0142 (the live budget), ADR 0146 (chrome and tokens), ADR
0028 and ADR 0132 (the bars and fills). Code: `crates/desk-wm/src/host/**`,
`apps/desk/shell/src/compositor_window/**`, `apps/desk/shell/src/web_host/relay.rs`,
`apps/desk/src/compositor-desk.ts`, `packages/runtime/src/shell/wm-desk.ts`,
`packages/runtime/src/frames/install.ts`. Tests: `crates/desk-wm/tests/host.rs`,
`compositor_window/hosted_tests.rs`, `apps/desk/src/compositor-desk.test.ts`,
`packages/runtime/src/frames/kept.test.ts`. No section of `docs/ko/desk-structure.md` changes.
