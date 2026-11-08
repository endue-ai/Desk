---
status: proposed
date: 2026-11-08
decision-makers: Team endue
---

# Eris knows every desktop's windows, the windows closed recently and every command

## Context and Problem Statement

ADR 0109 gave Eris the windows on the desktop in front and the drawer with every line. Since ADR 0117
a desk has any number of named desktops, and a window on another one did not exist for her. A window
the person closed was gone: nothing remembered where it was, so "bring back the terminal I just
closed" had no answer. And nothing told her what the person can do on this desk: which commands
exist, whose they are, which keys run them and whether they can run now, so "what can I do here" was
answered from her general knowledge, not from the desk. How does she learn all three without the
words before every line growing past what ADR 0109 meant to spend?

## Decision Drivers

* Every request reaches the right plugin, window or desktop with no extra round trip to look first
* A closed window comes back exactly where it was: place, size, panes, desktop and plugins
* The catalogue is the desk's own: the registry, the plugins' contributions and the keymap
* The words stay within a fixed size and cut the same way every time for the same desk
* Nothing new for the core to keep: the runtime holds the windows, the core words them (ADR 0109)

## Considered Options

* `BrainDesk` carries every desktop's windows, the desktops, a closed-window log and a capability
  summary; the core words each part within its share of a fixed budget; three agent commands answer
  the rest (`desk.windows.closed`, `desk.windows.reopen`, `desk.capabilities`)
* Tools only: Eris asks for the other desktops, the closed windows and the commands when she thinks
  of it, and the words stay as ADR 0109 left them
* The core keeps the closed windows and the catalogue itself, from its registry and cmd.* events

## Decision Outcome

Chosen option: "`BrainDesk` carries all of it, worded within a budget, and three commands answer the
rest", because a summary every turn lets her route a request at once, and the commands give her the
whole when the summary is not enough, while the runtime stays the one place that knows the windows.

* **Every desktop.** `BrainDeskWindow.desktop` names the desktop each window is on; `BrainDesk.desktops`
  lists them in order with `current` on the one in front. Windows come in front first (front to back),
  then the drawer's, then the other desktops' in their order, at most 64 as before. Each is where it
  is when its desktop is in front (that desktop's pan); a plugin window in its slot is named once, on
  the desktop in front. A snapshot without `desktops` (an older runtime) is worded as before.
* **Closed windows.** `eris-context/closed.ts` watches the store: a window that is on no desktop and
  not in the drawer any more has closed. Changes are looked at as they come and decided on once per
  task, so a window that goes somewhere in steps never counts, and one that closes keeps its layout's
  place, not the slot its plugin shows in until it stops. Nothing is logged before the desk has
  started (plugins, profile and session in), on a profile switch, or when desk.shell.layouts puts a
  saved layout back. Each entry keeps the id, title, plugins, resolved views, placement, desktop and
  wall-clock time; the last 20, the last first, in the shell's storage (`closed-windows`,
  `{ version: 1, closed }`). A window that comes back under its id showing the same views leaves the
  log. `BrainDesk.closed[]` carries them with `closedAt` (RFC 3339).
* **Reopening.** `desk.windows.reopen { id? }` (the last closed without `id`) puts the placement back
  in its desktop's layout (the one in front when that desktop is gone), brings that desktop to the
  front, runs `desk.plugins.open` for each plugin it showed that is not running and makes it the
  window in use. A plugin that cannot start takes it back out and leaves it in the log. When another
  window took its id, a window whose panes name their views comes back under a new `window-<n>`; a
  plugin's own window brings that window up. `desk.windows.closed` (read-only) lists the log.
* **Capabilities.** `eris-context/capabilities.ts` builds the catalogue from the registry (available
  now), the commands the plugins that are on contribute (available once their window is up) and the
  keymap (a key bound to a command nobody provides): id, title, owner (`desk` or the plugin), keys as
  people read them, and availability; and the plugins that are on with their command counts, window
  and views. `desk.capabilities` (read-only) answers it, filtered by owner, word or availability, 200
  commands at most by default. `BrainDesk.capabilities` carries the summary: the counts and the
  plugins with something to offer, those with a window open first.
* **The budget.** The core's words for the desk stay within 8,192 characters (about 2,000 tokens; a
  few hundred on a usual desk, as ADR 0109 meant). Each part has its share: the screen 3,840, the other
  desktops 1,536, the closed windows 1,024, the capabilities 1,280, a line at most 480. Items are added
  in order; the first that does not fit ends the part with "- … and N more (command)", naming
  `desk.windows.list`, `desk.windows.closed` or `desk.capabilities`. The same desk gives the same
  words. When the tools do not all fit a turn, plugins on other desktops come after those on screen
  and in the drawer.
* **Mounting.** `defineDeskView` mounts the module, so the shell's composition root is unchanged.

### Consequences

* Good, because "the notes on my other desktop", "reopen what I just closed" and "what can I do here"
  are answered from the desk in one turn, and reopening restores the window, not a new one.
* Good, because the words have a hard size the core enforces, whatever the desk holds.
* Bad, because every line now names the person's other desktops, closed windows and plugins to the
  brain they chose, as ADR 0109 already did for the screen.
* Bad, because a closed window is told from a moved one by watching the store: a window that leaves
  through a path that is none of the known ones (the person, a profile, a saved layout) counts as
  closed. It leaves the log when it comes back.
* Bad, because the catalogue names the desk's own commands `desk`, not the policy plugin that owns
  each: the registry mirror does not keep that owner.
* Neutral: a plugin that is off is not in the catalogue; desk.plugins.open turns it on when asked.

### Confirmation

`eris-context/closed.test.ts` (the log, its cap, what is not a close, persistence, reopening with the
geometry, desktop and plugin), `eris-context/capabilities.test.ts` (owners, keys, availability, the
summary and the command's filters), `shell/desk-view.test.ts` (every desktop, the current one,
`closed[]`), `crates/desk-core/tests/desk_context.rs` (the words for the other desktops, the closed
windows and the capabilities, and a crowded desk within the budget, the same twice), and the
`brain-say-*desk*` vectors.

## More Information

Specs: `specs/bridge/v0/brain.schema.json` (`BrainDesk`, `BrainDeskDesktop`, `BrainDeskClosed`,
`BrainDeskCapabilities`, `BrainDeskPlugin`). Runtime: `packages/runtime/src/eris-context/`,
`shell/desk-view.ts`. Core: `desk_context.rs`, `desk_context_parts.rs`. Builds on ADR 0088, 0109 and
0117.
