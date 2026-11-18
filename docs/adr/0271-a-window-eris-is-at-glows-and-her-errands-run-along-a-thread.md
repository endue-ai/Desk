---
status: accepted
date: 2026-11-18
decision-makers: Team endue
---

Amends ADR 0089 (where the window of an errand glows, which windows do, and what the spark runs
along) and ADR 0265 (the star's colour also lights where an agent is at work: the window's glow
and the errand's thread). Builds on ADR 0109 (the desk goes to the brain with every line), ADR
0151 and ADR 0201 (the compositor draws the windows, each from a page of its own).

# A window Eris looks at or uses glows around its frame, and her errands run along a thread

## Context and Problem Statement

An errand lit "the plugin's window" with a class on the element it found (ADR 0089). Since the
compositor draws the windows, that element is the plugin's section in the desk's page, at its pane:
the glow lay around the pane, not the window, in Eris's gold, in the page's picture, which is drawn
above every window, so it showed over a window lying in front and stayed behind a window on its
way. Only the first of a plugin's windows was found. Nothing showed which window she looked at when
a line came in, though the desk goes to her brain with it, and one spark does not read as data
going out and coming back. How does the person see which windows a line reached, and the data
moving between Eris and them?

## Decision Drivers

* The windows she looks at and uses are seen at a glance, several at once, softly, in the brand's
  one colour: the star's, which marks an agent at work (ADR 0265)
* The glow is the window's: at its frame, under what lies over it, with it when it moves
* No contract changes: a step names a command and its plugin, no window (`specs/bridge`)
* Laying the scene out again costs a frame's work (R1, `compose.rs`): nothing lays it out every
  frame for as long as she works, and a desk at rest draws nothing (ADR 0164)
* Reduced motion means no motion

## Considered Options

* The page says which windows are lit and how brightly; the compositor draws the glow with the
  window's frame; the page draws the thread
* The page draws the glow as an element of its own over the window
* The compositor animates the glow and the sparks itself, from the steps

## Decision Outcome

Chosen option: "the page says, the compositor draws the glow, the page draws the thread", because
the glow then belongs to the window in the stack and the errand stays one piece of code.

* **What she is at.** *Using*: every window of the desktop in front that shows a surface of the
  plugin a command belongs to, each once (`errand-targets.ts`), from `tool` until its sparks leave
  after `tool-result`. A plugin's section kept in the desk's page names its window by its group
  (`surface/anchors.ts`), and the spark flies to the window's middle where it is drawn, not to
  that place. A command of the desk's own has no plugin window, but may name one: the runtime
  hears each built-in the core asks it to run (`Commands.watchRuns`), and one Eris runs
  (`agent:eris`) uses the window its `window` names, or the one its answer names: that window
  glows and the errand's spark flies on to it (ADR 0269's window commands, `desk.windows.focus`).
  *Looking*: the window in use when a line comes in with the desk (`look`, the snapshot's focused
  window, which "this" means to the brain), neither in the drawer nor out of the canvas, until the
  turn is over and at least until her look's spark is back. A spoken turn sends no desk, so she
  looks at none.
* **How brightly** (`visiting.ts`): 0.6 looked at, 1 used, the brightest of the reasons at once.
  The store keeps `erisWindows`; a glow comes over 240 ms and goes over 480 ms on the ticker, in
  tenths, so a fade is at most ten changes; the desk has one account of them.
* **The glow.** The page's report names them (`lit`: window and level). `Chrome::glow`
  (`chrome/glow.rs`) puts one rectangle at the bottom of the window's group: a 2 px rim just outside
  the frame and a 28 px halo in the theme's `star`, at 0.75 and 0.42 of the level, taking no
  pointer. Where the page draws the windows (a browser, the tests) the window's section carries
  `is-eris-visiting` and `--eris-glow`, and `compositor.css` leaves that unpainted in the app.
* **The thread** (`errand-thread.ts`, `errand.css`): an SVG in the desk's page from Eris to the
  window along the spark's arc, in the star's colour, in a box that never moves; marks run out with
  the request, stand still while the plugin works, and run back with the answer. The spark keeps
  her own gold. A look is a bare spark there and straight back, which the turn does not wait for.
* **Reduced motion.** The windows light at once, the label waits beside her, no thread is laid.
  `Ticker.animate` with 0 ms rejected (its tick ran before `add` answered); it now ends in that
  tick.

### Consequences

* Good, because the person sees what a line reached, and the glow lies where the window is drawn
* Good, because nothing in `specs/` changes and the errand is still drawn once, by the runtime
* Neutral: the star's colour is no longer the star's alone. It still says one thing, an agent at
  work, now also where (`docs/design-system.md`, principle 2)
* Bad, because a step names no window: every window of a plugin glows, also when its command is
  about one of them; only the desk's own commands say which, by their `window`
* Bad, because each change of a glow is a report and a layout of the scene: up to ten as it comes
  and ten as it goes. It does not breathe: that would lay the scene out for as long as she works
* Bad, because a window out of the canvas in an OS window of its own, and a card in the spread, is
  not lit
* Bad, because a turn that waits (no brain answers) keeps the window she looks at lit for as long
  as she waits: the talk line has no way to stop a turn
* Bad, because the thread is laid when the spark leaves: a window moved meanwhile keeps the thread
  where it was until the spark flies back

### Confirmation

`packages/runtime/src/eris/{errand,errand-uses,errand-thread,visiting}.test.ts`,
`commands.test.ts`, `shell/ticker.test.ts`,
`apps/desk/src/compositor-desk.test.ts`, `crates/desk-compositor/src/chrome/glow.rs`,
`apps/desk/shell/src/compositor_window/{report.rs,report_lit_tests.rs}`; painted in
`packages/runtime/e2e/eris-errand.spec.ts`, and in the app, from the compositor's own frame and
with examples/brain-echo answering, in `e2e/specs/eris-glow.spec.ts`. The motion gate
(`just perf-motion`, ADR 0208) covers `draw.rs`; this adds no threshold to the compositor.

## Pros and Cons of the Options

### The page draws the glow over the window

* Good, because it needs nothing of the compositor and CSS fades and breathes for free
* Bad, because the page's picture lies above every window: the glow of a window under another is
  drawn over that one, and it trails a window the window manager moves ahead of the page

### The compositor animates the glow and the sparks

* Good, because both follow a moving window frame by frame
* Bad, because the errand is then drawn twice (the runtime's for a browser, the shell's for the
  app), with a clock and state of its own in the shell

## More Information

`docs/ko/desk-structure.md` names `eris/` only: no section of it changes; `docs/design-system.md`
says where the star's colour goes. Code:
`packages/runtime/src/eris/{errand,errand-targets,errand-thread,visiting}.ts`, `errand.css`,
`commands.ts`, `shell/Composer.ts`, `apps/desk/src/{compositor-desk.ts,compositor.css}`,
`crates/desk-compositor/src/{chrome.rs,chrome/glow.rs,theme/mod.rs}`,
`apps/desk/shell/src/compositor_window/{draw.rs,report.rs}`.
