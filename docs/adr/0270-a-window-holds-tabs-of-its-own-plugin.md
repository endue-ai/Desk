---
status: accepted
date: 2026-11-18
decision-makers: Team endue
---

# A window holds tabs of its own plugin, and no longer splits inside

## Context and Problem Statement

A window could be split into panes, right or down, and each pane could show any view: a plugin's
surface beside the launcher beside a calendar (ADR 0040). A window then had no one identity: its
title, its icon, its hints (ADR 0226) and whether it can pop out (ADR 0205) all had to choose a pane,
and a second Terminal meant a second window to place. People keep several of the same thing together:
several terminals, several notes. How does one window hold several of them, and what may it hold?

## Decision Drivers

* A window is one thing: a Terminal window holds terminals, never a calendar
* Each tab keeps its own page, sleep and wake, as a window of its own does (ADR 0212)
* Showing another tab never loads a page again (ADR 0151)
* What profiles and sessions saved still loads

## Considered Options

* Tabs: a window holds further windows of the plugin it shows, one shown at a time
* Keep the split, and add tabs inside each pane
* Tabs of any view, as the panes took any view
* Tabs inside each plugin's own page, as the Terminal draws its own

## Decision Outcome

Chosen option: "tabs of the window's own plugin", because it keeps a window one thing and reuses the
windows a plugin already has (ADR 0212) instead of a second way to show a plugin twice.

* **Model.** A placement has `tabs` (each an id and a view) and `tab`, the one it shows; absent, one
  tab showing the view named by its id, as before. `panes`, `split`, `close-pane`, `show-in-pane` and
  `resize-split` go; `add-tab`, `close-tab`, `step-tab` and `show-in-tab` come. A layout saved with
  `panes` reads as tabs, first pane first.
* **The rule.** A window takes a tab only when every tab it has shows a window of one plugin, and
  the new one is another window of that plugin (`<plugin>@<n>`) it does not show yet. desk-wm checks
  it (`Desk::add_tab`), so no caller can break it. A window of the shell's own view (the launcher, a
  sample view, an agent) takes none, and has no tool for one.
* **A tab is a window of the plugin.** New tab asks the runtime for another window of the plugin and
  tells desk-wm of the tab first, so that window never has a slot of its own. Any plugin's window
  takes tabs, whatever its manifest's `instances` says: that key says when the desk opens windows by
  itself, and a tab is the person asking. Closing a tab unmounts that window alone; a window's last
  tab closes it. A tab whose plugin window the runtime does not hold is not there.
* **On screen.** The tab shown fills the body. A window of several tabs keeps a 28 px strip of them
  at the body's top, drawn by the page; the title bar gains New tab and loses the two split tools.
  The plan seats the tab shown only: the others are out of sight, and sleep by the live budget.
* **Keys.** `desk.display.new-tab` (Mod+D), `next-tab` and `previous-tab` (Control+PageDown and
  PageUp), `close-tab`. Mod+W closes the plugin window in use as before, which takes its tab.
* **The contract.** `desk.windows.list` keeps `panes`: one for each tab, the one shown marked
  `focused`.

### Consequences

* Good, because a window has one plugin: one title, one set of hints, and a clear answer to what a
  new tab is.
* Good, because a hidden tab is a page that sleeps and wakes like any window out of sight.
* Bad, because two different things can no longer share one window; they are two windows side by
  side (snap, tile).
* Bad, because each tab is a renderer, and a plugin written for one window may share state between
  its tabs in ways it did not expect.
* Bad, because a plugin's later windows do not come back with a layout (ADR 0212): after a restart a
  window comes back with the tabs whose windows the runtime holds.
* Bad, because `desk.windows.list` still calls a tab a pane.

## More Information

Amends ADR 0040 (a window's panes and splits) and ADR 0212 (a later window may be a tab).
`crates/desk-wm/src/tabs.rs`, `host/tabs.rs`, `desk/windows.rs`; `packages/runtime/src/surface/
TabsView.ts`, `shell/windows.ts`. Tests: `crates/desk-wm/tests/tabs.rs`,
`packages/runtime/src/shell/windows-tabs.test.ts`, `packages/runtime/e2e/shell-tabs.spec.ts`.
