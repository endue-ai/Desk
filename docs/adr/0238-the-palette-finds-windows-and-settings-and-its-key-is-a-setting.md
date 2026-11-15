---
status: accepted
date: 2026-11-15
decision-makers: Team endue
---

# The palette finds windows and settings, asks a command's args, and its key is a setting

## Context and Problem Statement

Search Desk left out every command whose `argsSchema` requires args, had no way to reach an open
window or a settings row, and its key from any app (⌘⇧Space) changed only through the
`DESK_PALETTE_SHORTCUT` environment variable (#304). Three things had to be decided that code and
people's files will depend on: where the Windows and Settings groups come from, the name and owner
of the key's setting, and how a command's args are asked.

## Considered Options

* Groups: the palette fetches every window and settings row when it opens and matches them itself;
  or the desk defines two palette providers of its own, as plugins contribute theirs.
* The key: a setting the palette's manifest declares (`desk.palette` owning `shortcut`); or the
  runtime's own core setting `palette.shortcut`, read as `desk.palette.shortcut`.
* Args: a form per command; or one question at a time in the palette's input.

## Decision Outcome

* **The desk's own providers.** `desk.palette.providers` answers `desk.windows.find` ("Windows")
  and `desk.settings.find` ("Settings") ahead of the plugins' providers, each while its command is
  defined. They answer PaletteResults, so the palette needs no new kind of row and an agent can ask
  them too. A window's action is `desk.windows.focus`, which now brings the window's desktop to the
  front first; a setting's is `desk.settings.open { section, row }`, which scrolls to the row and
  focuses its control.
* **`desk.palette.shortcut` is the runtime's own setting.** In the core its owner is `desk` and its
  key `palette.shortcut`, as `desk.update.channel` is `update.channel`: core settings belong to the
  caller that sets them, so only the runtime, which draws Settings, can write it. init.yaml cannot:
  there `desk.palette.shortcut` names the palette plugin's keys (the longest owner wins), and an
  init.yaml edit sends no `settings.changed`. The value is written in the shell's shortcut syntax
  (`CommandOrControl+Shift+Space`), as `endue.eris.shortcut` is. The shell reads it at start and on
  every `settings.changed` for it, so a change applies without a restart; `DESK_PALETTE_SHORTCUT`
  still wins. The shell says what it holds in `palette.shortcut.held`, and Settings shows that key,
  not the one saved. A key the OS refuses or the shell cannot read keeps the one held before (at
  start, with none held, ⌘⇧Space), goes back out of the setting when refused while the desk runs,
  and is said in Settings and in a notice that waits until the runtime is up to show it.
* **One question at a time.** Choosing a command whose schema requires args asks each required
  property in order in the palette's input: free text, or a pick of its `enum` (true and false for a
  boolean). Enter answers and, on the last, runs the command with the answers read as their types;
  Escape steps back one question, then out to the list. Optional properties are not asked.

### Consequences

* Good, because everything on the desk is one search away, from the same list and keys.
* Good, because no spec changes: providers, PaletteResults and settings keep their shapes.
* Bad, because the Windows and Settings groups show only once two characters are typed, as every
  provider's do, and match words, not the palette's fuzzy ranking.
* Bad, because commands made for agents (a window by id) now show in the list and ask for an id in
  plain text; a pick of real values would need the schema to name where they come from.
* Bad, because Settings knows before saving only the conflicts the desk itself holds (Eris's key,
  the desk's own keys); a key another app holds is learned from the shell's answer after the save.
* Bad, because a command whose required args are a list or an object cannot be typed: the palette
  leaves it out, so agents and keys with args are its only way in.
