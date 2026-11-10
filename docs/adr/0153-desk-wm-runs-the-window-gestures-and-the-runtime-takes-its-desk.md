---
status: accepted
date: 2026-11-10
decision-makers: Team endue
---

Status: amended by ADR 0156: the compositor is the only desk, so `desk-wm` runs every window gesture
and command; the windowed desk and the runtime's own drag, resize, snap, glide and window commands are
gone, and a desk without the compositor (the runtime's tests) moves no window.
Amended by ADR 0158: `desk-wm` holds the desk and publishes it whole on every change, with the
answers to the runtime's edits; calls follow the last edit (`after`), not the last report.

# desk-wm runs the window gestures on the compositor's input, and the runtime takes its desk

## Context and Problem Statement

In compositor mode (ADR 0151) the runtime published its desk and `desk-wm` placed what the
compositor drew, but the page's DOM window manager still moved, resized and snapped windows from
the pointer the compositor handed the page, the cards' buttons were drawn where the page's were not,
and the snap preview and the glides were the page's. #80 moves dragging by the title bar, the eight
resize grips, pointer capture, 8-way snap with its intent rule, the preview growing out of the
window and the window gliding into its part, Escape, the Shift + drag pan and the keyboard's window
commands into `desk-wm`, on the compositor's input. The runtime still keeps the window manager's
state until #83, and the page's system layer (bars, Eris, menus) still floats above the windows
until #55, so only the page knows whether a press lands on a title bar or on a bar lying over it.
How does the change go back to the runtime, and who decides what a press starts?

## Decision Drivers

* One window manager runs each gesture, on the compositor's input: `desk-wm`, the code #83 keeps
* The runtime's store stays the one record of geometry (sessions, profiles, `desk.windows.list`)
* What a press lands on is decided where the shape of everything over the windows is known
* The windowed desk unchanged; the same `desk.display.*` commands on both desks
* Behaviour and numbers as the runtime's: the 8 px threshold, 24 px zones (8 at the top), the
  intent rule, `--motion-base` and the desk's easing (ADR 0128, ADR 0132)

## Considered Options

* `desk-wm` runs the gesture from the page's grab and publishes each change; the runtime takes it
* `desk-wm` hit tests title bars and grips itself and never asks the page
* The page keeps running the gestures and sends the shell each move

## Decision Outcome

Chosen option: "`desk-wm` runs the gesture from the page's grab and publishes each change",
because the gesture runs on the compositor's input with the runtime's numbers while the page,
which alone knows what floats above a window, still says what a press starts.

* **The seam, the other way round.** `desk_wm::interact::Wm` holds the desk the runtime last
  published (ADR 0151) and the changes it made since. Each change (a window's whole geometry: its
  rect in its mode, the mode, the fill and its restore; or a canvas's pan) is published under a
  revision (`desk://compositor-wm`); the runtime writes it into its store as a session edit
  (`takeWm`, `shell/wm-host.ts`), the truth for geometry, and its next report says which revision it
  took (`applied`). Until then `desk-wm` keeps drawing its own, so a report made before the runtime
  took a change never draws the window back.
* **Who decides what a press starts.** The compositor's pointer reaches `desk-wm` before the router.
  A press on a window's grip goes to the page rather than to the plugin surface the grip lies over
  (`InputRouter::press_to`). The page's DOM finds what the press lands on, as the runtime's handles
  accepted it (the title bar away from its tools, a grip, Shift on the canvas or a title bar, never
  a pinned window's title bar, never a bar above it), and says so (`compositor_grab`). `desk-wm`
  keeps the press and what followed it until the grab arrives, then plays it into the gesture, so a
  drag finished before the page answered still lands; the grab names the press where the page heard
  it, which differs from the screen's point for a window drawn ahead of the page. The page sends its
  desk before each grab and window command and names it (`after`): the shell runs each page call on
  a thread of its own, so a small call may overtake the desk it follows, and the shell holds it
  until that desk is in. The page's handles keep their drag lifecycle
  for the cursor, no text selected and the click after a drag swallowed; they move nothing.
* **The gestures** (`desk_wm::interact`): the threshold, capture (the page holds the pointer, so no
  plugin hears a drag), moves with the snap aim and its intent rule, a filled window coming off its
  fill under the pointer with its size gliding back, resizes from the eight grips with the opposite
  edges anchored, the pan of the desktop it started on, published as it moves. Escape cancels a
  drag and goes nowhere else; the app losing the focus cancels it too.
* **Drawing.** Each frame `Wm::frame` says where a held or gliding window is drawn and where the
  snap preview is: it grows out of the window's box and glides from part to part, under the dragged
  window, in the theme's `SnapPreview` chrome. A window whose fill changes (a snap on the drop, a
  maximize, a restore, the runtime's own) glides there over `--motion-base` with the desk's easing;
  reduced motion moves nothing. While a gesture holds a window the page lays it out there too
  (`desk://compositor-held`, echoed in the report), and what the page draws of a window is taken
  from where the page lays it out to where it is drawn (`host::Places`, `page_parts`), the title
  bar's tools kept to its right end.
* **A press mid-glide** (#124). The page lays a gliding window out where its glide ends, so what
  its DOM finds under a press on the window as drawn is not what the person pressed. While the
  window topmost under a press glides, `desk-wm` hit-tests the press against the rectangle drawn
  last (`interact/mid_glide.rs`): a grip resizes the window, its title bar away from its tools (and
  from the top chips over a fill's) moves it, the gesture starting with the press and the page's
  grab for it unheard. The glide ends at once: the window stays where it was drawn while the press
  holds it, and a drag takes it from there; a press that never drags, or a cancelled drag, lets it
  glide on from there. A press elsewhere on it is the page's and the surfaces' as before.
* **Cards.** A placeholder card's Wait, Stop and Reload are the compositor's own buttons: they run
  `desk.frames.wait`, `stop` and `reload` for their plugin in the page (`desk://compositor-run`).
* **Window commands.** `desk.display.maximize`, the eight `snap-*`, `move-*` and the four
  `grow-*`/`shrink-*` (a 32 px step; moving or resizing a filled window ends its fill where it is)
  run on the window in use: in compositor mode `desk-wm` runs them (`compositor_wm`, the page
  sending its desk first), on the windowed desk the runtime's own window manager does. The title
  bar's double-click is `maximize`; a press that became a drag counts as no click, so a title bar
  dragged twice in a row is not double-clicked.

### Consequences

* Good, because every window gesture in compositor mode runs on the compositor's input in Rust
  with the runtime's rules, each a CPU test (`crates/desk-wm/tests/interactions.rs`), and the
  preview, the glides and the cards' buttons are the compositor's.
* Good, because the runtime's store stays the one record: sessions, profiles and `desk.windows.list`
  read geometry as before, and #83 only removes the page's half of the seam.
* Bad, because a press's start waits on the page's grab: a page that never answers starts nothing
  (the press still reaches the page), and the grab is matched to the press by its point.
* Bad, because the page's handles still run their drag lifecycle beside `desk-wm`'s, for the cursor
  and the click after a drag, until #83 and #55 give the compositor the cursor and the bars' shape.
* Bad, because the new window commands have no default keys yet: the palette, agents and a
  person's own bindings reach them.

## More Information

Issue #80 (child 3 of #53, epic #32 §5). Amends ADR 0151 (the seam's direction, the input's last
bullet and the Bad consequence about the pointer working the page's windows), ADR 0128 and ADR 0132
in compositor mode (where the preview and the glide are drawn). Code: `crates/desk-wm/src/interact/**`,
`crates/desk-wm/src/host/{mod,parts}.rs`, `crates/desk-compositor/src/input/{pointer,router}.rs`,
`apps/desk/shell/src/compositor_window/{wm,hosted,draw}.rs`, `apps/desk/src/compositor-wm.ts`,
`packages/runtime/src/shell/{wm-host,window-commands}.ts`, `packages/runtime/src/surface/host-gestures.ts`.
Tests: `crates/desk-wm/tests/interactions.rs`, `crates/desk-compositor/tests/input_routing.rs`,
`compositor_window/draw_tests.rs`, `packages/runtime/src/shell/window-commands.test.ts`,
`packages/runtime/src/surface/host-gestures.test.ts`, `apps/desk/src/compositor-wm.test.ts`,
`e2e/specs/windows-*.spec.ts` with `DESK_COMPOSITOR=1`. No section of `docs/ko/desk-structure.md`
changes before #83.
