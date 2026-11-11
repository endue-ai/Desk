---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0117 (its Keys bullet: `Mod+Shift+1…9`) and ADR 0118 (Settings › Keyboard named each
conflict's file and line).

# The desk ships no key the system keeps, and Settings words conflicts for a person

## Context and Problem Statement

The QA pass of 2026-11-11 (#158) opened Settings › Keyboard on a fresh desk and found "Shortcut
conflicts (3)" in orange: `plugins/shell/plugin.json` bound `Mod+Shift+1…9` to "Window · To desktop
N", and on macOS ⇧⌘3, ⇧⌘4 and ⇧⌘5 take screenshots, so those three never reach the desk (finding 16).
Each line read as a developer's: `warning: ⇧⌘3 for Window · To desktop 3 (/Users/…/plugins/shell/
plugin.json contributes.keys[11]) uses ⇧⌘3, which macOS keeps …`, the path once more under it, and
the raw id `desk.shell.move-to-desktop-5` for a desktop not there yet. The list under them was 378
commands and 36,390 px with no index, so a search's one match lay below the fold (finding 19).
Which keys move a window to a desktop on the Mac, and what does Settings say about a conflict?

## Decision Drivers

* A person who changed nothing is told of no conflict, on any platform
* Moving a window to desktop N is one family of keys for 1 to 9, not six and three others
* Settings speaks to the person who uses it; the file and line stay for whoever fixes a manifest
* The other platforms keep the keys they have

## Considered Options

* On macOS only, `Control+Shift+1…9` (the `mac` key of `contributes.keys`); `Mod+Shift+1…9` elsewhere
* `Mod+Alt+1…9` everywhere
* Move only 3, 4 and 5; or keep the keys and leave the warning
* Settings keeps the developer's line from `sequences/report.ts`

## Decision Outcome

Chosen option: "`Control+Shift+1…9` on macOS", because it is the same physical chord the other
platforms already have (`Mod` is Control there), it sits next to the core's `Control+1…4` that switch
desktops, and nothing on macOS or in the desk holds it. `Mod+Alt` is AltGr on Windows, where it types
characters on many layouts; moving three keys of nine splits one family.

* **Keys.** `desk.shell.move-to-desktop-1` to `-9` are `Mod+Shift+1…9` with `"mac": "Control+Shift+1…9"`
  in `plugins/shell/plugin.json`. A test resolves the core's keys and every built-in plugin's, as they
  ship, on macOS and elsewhere, and finds no conflict Settings would show
  (`settings-ui/keyboard-defaults.test.ts`).
* **Conflicts in words** (`settings-ui/key-conflicts.ts`). Settings › Keyboard lists a conflict as
  the command's title (or "A command not available now"), its keys, why it does not run ("macOS uses
  this key: it takes a screenshot. Turn that shortcut off in the system's settings, or give this
  command another key."), and who set it: you, built in, or the plugin by its name. No file, line or
  id. A key that two layers give the same command loses nothing and is not listed. While a search
  holds words the conflicts give the pane to its matches. `desk.keys.conflicts` and
  `desk settings lint` keep ADR 0118's lines with file and line.
* **The list** (`settings-ui/key-list.ts`, `jump.ts`). It opens on the commands that have a shortcut
  ("With a shortcut (50)"; "All commands (378)" on the switch beside it), in groups by who provides
  them (Desk, then each plugin by name) with an index of the groups; a search looks in every command.
  A row whose key is cleared stays until the view changes. Settings › Plugins has the same index.

### Consequences

* Good, because a fresh desk's Keyboard opens on no conflict, and a conflict a person makes says what
  to do in their words.
* Good, because the Keyboard pane is about 50 rows, not 378, until the person asks for all.
* Bad, because a Mac moves windows with ⌃⇧ while it switches desktops with ⌘: two modifier families
  for one feature. A person who wants ⇧⌘ back (with the screenshot keys off) binds it in Settings.
* Bad, because a command with no key yet is found by a search or under All commands, not by scrolling
  the first list.
* Neutral: someone fixing a manifest reads the file and line in `desk.keys.conflicts` or the lint, not
  in Settings.

## More Information

Issue #158 (findings 16 and 19). `plugins/shell/plugin.json`, `plugins/shell/README.md`;
`packages/runtime/src/settings-ui/{key-conflicts,key-list,jump,keyboard,window}.ts`;
`packages/runtime/src/sequences/keyboard-parts.ts` (the rebind question names who set a key it
would shadow, through the same words). Tests: `settings-ui/{keyboard-defaults,key-conflicts,keyboard}.test.ts`,
`shell/commands.test.ts`, `packages/runtime/e2e/settings.spec.ts` ("keyboard settings for a person").
