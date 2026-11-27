---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# A window's title bar holds three tools and a menu

## Context and Problem Statement

Every window's title bar carried five small tools (New tab, Floating mode, Pin, Pop out, Close) in
a 40 px bar, with no names but their hover titles, and the pinned and floating states shown only by
a tool's colour. Most are used rarely, and a row of five icons on every window is noise; the design
(#291, "Windows: the title bar") asks for a quiet bar. Where do the other tools go, how high is the
bar, and how do the page, the window manager and the compositor stay on the same pixels?

## Decision Drivers

* A tool used on every window stays one press away: Close, and Pop out where it applies
* What a tool did still runs the same way, by pointer, by keyboard and by its command
* The page (`surface.css`), desk-wm (`host::TITLE`, `TITLE_END`) and the compositor's theme
  (`title_height`) lay the bar out with the same numbers: no frame, grip or hit area is off
* The motion gate stays green (ADR 0208)

## Considered Options

* Three tools (the window menu, Pop out, Close) and the rest as rows of the window menu
* Keep the five tools, smaller
* A menu of its own on the tool, beside ADR 0117's right-click menu
* Show pinned and floating on the menu's tool instead of marks of their own

## Decision Outcome

Chosen option: "three tools and the window menu", because it keeps the tools a window needs most
in reach and gives every other one its name and key in a list that works by keyboard.

* **The bar.** 36 px, its bottom line included: one custom property in `surface.css`
  (`--surface-title-height`), desk-wm's `TITLE` and the compositor's `title_height`, which a test
  checks against each other. At its end, 2 px apart: the window menu (three dots), Pop out (only a
  window that shows one plugin and nothing else, issue 235) and Close. Each is 24 px; its hover
  title is its name and the first key bound to its command (`desk.windows.pop-out`,
  `desk.windows.close`), which the compositor draws (ADR 0193); its accessible name is the name.
* **The marks.** A pinned window shows a pin and a floating one a floating mark, 16 px in the accent
  colour, before the tools: images with their names, not buttons, so a press on one drags the
  window. `TITLE_END` is 128 (the end padding, the three tools, room for both marks, the gap): the
  compositor's title never runs under a mark, shown or not.
* **One window menu.** The tool opens ADR 0117's window menu, which a right-click on the bar still
  opens, under the tool in the desk's page (the `desk.overlays` part, ADR 0160), or above it where
  the app ends first, its point moved onto the desk when the window lies in a page of its own (ADR
  0201). The desk's page hears a press over a window too (ADR 0150), there on nothing of its own:
  the press on the tool that opened the menu is the tool's, never one outside that closes it. Its
  rows: New tab (`desk.display.new-tab`, off on a window that takes no tab, ADR 0270), Maximize or
  restore (`desk.display.maximize`), Floating mode and Pin (checked rows), Put in drawer
  (`desk.windows.put-away`, issue 280), each with its key when it has one, then the "Move to" rows.
  Each runs what its tool ran. Arrows, Home and End walk it; Escape and Tab close it and give the
  focus back to the tool; `aria-expanded` follows.
* **Sizes.** A window keeps its outer size, so its body grows by 4 px; a window opened at a plugin's
  hinted page size (ADR 0226) is 4 px shorter, and its page the size it asked for.

### Consequences

* Good, because a bar shows three tools and the window's state, and every other action has a name,
  a key and a keyboard path.
* Good, because the three places that lay the bar out are checked against one another.
* Bad, because New tab, Floating mode and Pin take two presses instead of one.
* Bad, because the marks' room is kept when they do not show: a title has 36 px less than three
  tools alone would leave it (still 16 px more than the five tools did).

## More Information

Issue #298 (composition D, #291). ADR 0117 (the window menu), ADR 0193 (hover titles), ADR 0201
(a window's own page), ADR 0270 (tabs, which replaced the split tools), issue 280 (no drawer tool).
No millisecond threshold is added: the motion gate's numbers stand.
