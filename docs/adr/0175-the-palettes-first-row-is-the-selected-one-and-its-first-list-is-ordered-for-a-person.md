---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0053 (core-owned search documents and an OS-level palette).

# The palette's first row is the selected one, and its first list is ordered for a person

## Context and Problem Statement

The palette listed the registry's commands as `cmd.list` gave them, in the order the plugins happened
to register them, so the list a person saw first (about 380 commands) changed from one start to the
next and was led by maintenance commands, some of which could never run from there. The plugins and
their data the field promises came after them. Typing ranked a keyword as high as the label the row
shows, so `sett` ran "Settings · keyboard shortcuts" before Settings, and the plugins' hits, which
arrive after the commands (with the OS index's answer, up to three seconds later), were put above
them while the selection stayed on the row it was on: `term` + Enter ran "Docker: open a shell in
the container" (issue #158, findings 11 and 12). How should the palette order its rows, and which
one does Enter run?

## Decision Drivers

* Enter runs the row the person sees first, whatever arrives after they typed
* The words on a row decide where it ranks before its keywords do
* The first list reads the same on every start, and leads with what a person opens
* A row the palette cannot run is not offered

## Considered Options

* The first row is the selected one until the arrows move it; plugins and commands in one ranking;
  a first list of Recent, Plugins, Commands A to Z
* Keep the selection on its row as results arrive, and only rank better
* Wait for every source before showing anything

## Decision Outcome

Chosen option: "the first row is the selected one", because what Enter runs is then always what is
highlighted at the top, and the person who moved the selection keeps it.

* **Selection**: the first row is the selected one; once the person moves it with the arrows it
  stays on its row while results arrive, until the text changes or that row goes.
* **Typed**: the commands and the plugins' hits (a plugin, or data it published) in one order: a
  match holding the query whole before a fragment, then a label (a plugin's name) before an id or a
  keyword, then the closer match; a hit ahead of a command that matches as well. A hit the index found
  in its description or text alone follows the matches. Providers' groups and OS results follow.
* **Nothing typed**: Recent (commands run and plugins opened from the palette, most recent first),
  Plugins (every launchable one, asked for at once), then Commands A to Z by title with numbers by
  value, each under its heading. Published data waits for a query.
* **Not listed**: a command whose `argsSchema` requires args; the core refuses it with `{}`, the only
  args the palette has. Keys, agents, the CLI and other plugins still run it.
* `Mod+K` with the desk's palette open closes it.

### Consequences

* Good, because `term`, `Agents`, `Eris` and `sett` + Enter open what was typed.
* Good, because the first list is the same on every start and shows the plugins.
* Bad, because a command that needs args has no row until it can ask for them (a pick) instead.
* Neutral: the history now holds `plugin:<id>` entries next to command ids.

## More Information

`plugins/palette/ui/match.js` (`rank`, `commandEntries`), `ui/main.js`;
`plugins/palette/tests/first-row.test.ts`, `tests/order.test.ts`;
`packages/runtime/e2e/palette-order.spec.ts`.
