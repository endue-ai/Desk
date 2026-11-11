---
status: proposed
date: 2026-11-08
decision-makers: Team endue
---

Status: amended by ADR 0158: `desk-wm` tiles, cascades and restores; the spread, which the page drew
over windows the compositor now draws, waits for the compositor to draw it (#54), its command, key
and strip button with it.
Amended by ADR 0161: the compositor draws the spread from the windows' live textures, its controller is
`desk-wm`'s (`spread::run`, on the window manager's clock), and its command, key and button are back; a
covered window shows live on its card, a sleeping one its last frame greyed, and the scrim darkens
without a blur.
Amended by ADR XXXX: a cascade lays the windows out back to front as they stack (the order of use),
the window in use last, and leaves the stacking as it was.

# Windows tile, cascade and spread from the right edge

## Context and Problem Statement

The desk has one window manager (ADR 0040): normal windows on the canvas, floating ones anchored
above them (ADR 0082). A person with many windows can only drag, snap and maximize them one at a
time. The person asked for three ways to tidy the desk at once, from buttons on the right side: a
grid, an overlapping cascade, and a "Minority Report" spread that fans every window out to pick one.
Where do arrangements live and what do they move? How is one undone? And how does the spread show
every window without waking every unloaded plugin (ADR 0070)?

## Decision Drivers

* One window manager: an arrangement moves the same placements a drag does, as a session edit
* Each arrangement is one step on the desk's undo stack (ADR 0077), plus a Restore that works without it
* Floating windows stay where the person anchored them; pinned ones stay put
* The spread moves nothing and wakes nothing: covered and unloaded frames stay as they are
* Geometry and motion that tests can freeze (ADR 0011, ADR 0013)
* Keys, the palette and Eris reach the same actions as the buttons

## Considered Options

* Arrangements as built-in `desk.windows.*` commands that name their undo; the spread draws the real
  windows at a transform
* Arrangements as saved layouts, one profile per arrangement
* A spread of its own cards, drawn from snapshots of each window
* The buttons in the status rail

## Decision Outcome

Chosen option: "built-in commands that name their undo, and a spread of the real windows". The
window manager already owns the placements and the session layer. Live windows need no snapshots.
And a transform changes nothing that the layout, the cover test or the unloading reads.

* **Where.** The code lives in `packages/runtime/src/arrange/` and is mounted from
  `surface/Surface.ts`. The geometry is pure (`geometry.ts`): the same count in the same area always
  gives the same places.
* **Tile.** Tile lays out the normal, unpinned windows of the current desktop, in desk order, as a
  grid that fills the free area: between the side bars and above the bottom line, and under Eris
  while she sits in her default place.
  * The shape is the one whose cells come closest to 4:3, with a short last row costing a little.
    On a wide screen that gives 2 × 2 for four windows, 3 + 2 for five and 4 × 3 for twelve.
  * A short last row stretches across, so the cells and the gaps fill the area exactly. The gap is
    the design system's `--desk-space-3`.
* **Cascade.** Every window takes one size (60 % by 65 % of the area). Each sits 32 px down and to
  the right of the one before, from the top left. A run that would leave the area starts again at
  the top, moved right. The focused window goes last, on top. The arranged windows move to the end
  of the layout in that order, so the stacking (desk order, ADR 0082) follows the cascade whichever
  window takes the focus later.
* **One step.**
  * Each arrangement is one store change. A plugin window that sat in its slot enters the layout
    where it was put (ADR 0040).
  * Built-in commands can now name their inverse (`CommandSpec.undo`, passed to `cmd.register`).
    Tile and cascade name `desk.windows.restore-arrangement`. They answer
    `{ desktop, entry, kind, windows }`: what the core's stack hands back to the inverse.
  * The runtime keeps 20 arrangements per desktop. Restore with no arguments (the strip, the
    palette, `Mod+Alt+Z`) puts back the current desktop's latest. After a desktop switch, each
    desktop restores its own.
  * `cmd.undo` names its entry. When nothing changed on that desktop since, the desktop comes back
    exactly, its session layer included. Otherwise each arranged window still there takes back its
    kept geometry.
  * An entry already restored does nothing. One the page no longer holds (a reload under a core
    that kept its stack) is restored from the geometry in the answer.
* **Spread.**
  * A scrim blurs the desk and its bars. The windows' layer rises above it with a perspective, and
    each window is drawn at a pose: a transform and an opacity. Plugin frames keep running, and the
    layout and the cover test see the windows where they are.
  * A window whose plugin frames are all covered or already unloaded gets a placeholder over its
    content, and choosing it brings the frame back.
  * The fan takes as many rows as makes its smallest card largest, each extra row costing a
    quarter. Windows keep their order on screen: rows from the top of the desk, left to right. A
    row's outer cards turn up to 14° towards the middle and dip a little. Each row further back sits
    160 px deeper and leans back 3°. With reduced motion the same boxes become a flat grid, with no
    turn, no depth and no motion.
  * Motion runs on the shell's frame loop (the injected clock, ADR 0013), with durations from
    `--desk-motion-*`.
  * Arrow keys move spatially, Tab and Shift+Tab in order, Home and End to the ends. Enter or a
    click chooses, Escape or a click on the empty desk cancels, and typing filters by title. The
    pointer over a card selects it. A drag or the wheel on the scrim pans, and a pinch or
    Control + wheel zooms about the pointer.
  * Choosing pans the canvas to bring a normal window wholly into sight, then focuses it.
  * For assistive technology the spread is a dialog whose field is a combobox over a list of the
    windows' titles.
* **Strip.** A toolbar of four design system icon buttons: Tile, Cascade, Spread and, after a
  divider, Restore.
  * It sits on the right edge under the status rail, above the running work, and becomes a row on
    apps shorter than 720 px.
  * The rail keeps its role (ADR 0104).
  * There is one Tab stop and the arrow keys move inside. Tooltips and `aria-keyshortcuts` name the
    keys. Restore is `aria-disabled` until there is a layout to restore.
* **Keys.** `Mod+Alt+G` tiles, `Mod+Alt+C` cascades, `Mod+Alt+S` spreads and `Mod+Alt+Z` restores.
  Tile is not on T: Control+Alt+T opens a terminal on GNOME, and `create-plugin`'s policy template
  binds Mod+Alt+T. The terminal hands all four to the desk (`plugins/terminal/ui/keys.js`), as it
  does the desk's other chords, so they work from inside a terminal on every platform.

### Consequences

* Good: arranging is window management like a drag. It saves, dirties the profile, restores and
  undoes the same way, and the palette and Eris run it as tools (ADR 0088).
* Good: the spread costs no plugin a reload. What was asleep stays asleep until it is chosen.
* Good: any built-in command can now be undoable by naming its inverse.
* Bad: the history of arrangements is in memory, as the core's stack is; a quit loses both.
* Bad: on Windows, Control+Alt is AltGr on many layouts: Control+Alt+S, C and Z type ś, ć and ż on
  a Polish keyboard. The keymap takes chords even in text fields, as it already does for
  Mod+Alt+D. A person can rebind them.
* Bad: outside macOS, Control+Alt+C, S, Z and G no longer reach a program running in the terminal;
  the desk takes them, as it takes Control+Alt+D.
* Bad: while the spread animates, WebKit holds every window as a transformed layer above the bars
  and uses notably more memory. In the 3 GB e2e container, four pages spreading at once crashed, so
  the spread's specs run one at a time.
* Bad: the strip sits beside the rail, not in it. When the rail moves into a plugin (#490), the
  strip may join it.

## More Information

Amends ADR 0040 (window management on top of drag and resize) and ADR 0077 (built-ins naming their
undo). Issue #541. Code: `packages/runtime/src/arrange/`, `packages/runtime/src/commands.ts`
(`CommandSpec.undo`), `packages/runtime/src/core/keys.ts`, `plugins/terminal/ui/keys.js`. Tests:
`arrange/geometry.test.ts`, `arrange/commands.test.ts`, `arrange/spread.test.ts`,
`core/keys.test.ts`, `plugins/terminal/tests/keys.test.ts` and
`packages/runtime/e2e/arrange.spec.ts`. `docs/ko/desk-structure.md` and `docs/architecture.md` do
not describe window management in this detail, so neither changes.
