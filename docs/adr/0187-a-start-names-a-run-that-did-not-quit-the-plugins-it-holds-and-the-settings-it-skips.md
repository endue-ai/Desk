---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Extends ADR 0061 (safe mode and quarantine), ADR 0079 (plugins.lock) and ADR 0080 (setting values
that fail fall back).

# A start names a run that did not quit, the plugins it holds off and the setting values it skips

## Context and Problem Statement

The QA pass of 2026-11-11 (#163, findings 10, 12, 13 and 14) found four places where the desk knew
something about its own start and kept it to itself. A run ended by a kill or a signal left no crash
report and the next start said nothing; last-start.json only told a start that reached ready from one
that did not. `desk plugin sync` right after a start turned on `endue.onboarding`, which init.yaml held
off: plugins.lock records the remembered choice (holds aside, by design), plugin.list only the state of
this run, and nothing told the two apart. With the dock and the palette off, or every plugin held off by
init.yaml, nothing on the desk opened the Plugins list again. And a setting value that fell back to its
default was named on the log with its file and line, never on the desk (ADR 0080 left the notice to
later). How does a start say each of these, without new files or a new surface?

## Decision Drivers

* The person learns what went wrong on the desk, once, not from a log
* A hold for a run (init.yaml, safe mode, a quarantine) stays a hold: nothing makes it a choice
* No new state file, no second notice surface; an older desk's files still read
* The way back to turning plugins on is not itself something that can be turned off

## Considered Options

* Tell each in place: a `quit` mark in last-start.json and an `exit` crash report; `heldOff` in
  plugin.list, which the sync plan reads; a default key for the Plugins list; a core notice at the
  runtime's first init.get
* Catch the signals and write the report as the desk dies; record holds in plugins.lock; make the
  Plugins list impossible to turn off; leave the notice to the runtime's settings window

## Decision Outcome

Chosen option: "tell each in place", because each piece uses a file, a call or a surface the desk
already has, and none changes what the person chose.

* **A run that did not quit.** Each start writes `quit: false` in last-start.json, and every quit the
  desk agrees to (the menu, the Dock, logout, the last window, "Start normally") marks it `true`,
  keeping the record as it stands on disk. A start that finds `false` writes an `exit` report in
  `<data>/crashes` (desk-crash: when that run started, its process, whether it got ready) unless that
  run left a `panic` report of its own; the crash card and `desk doctor --last-crash` show it like any
  other. A record without `quit` is an older desk's and says nothing of how its run ended.
* **Holds.** plugin.list's `PluginInfo` gains `heldOff` (`init`, `safe-mode`, `quarantine`): the
  plugin is off for this run only, whatever its remembered choice says. plugins.lock keeps the
  remembered choice; `desk_core::lock::plan`, what `desk plugin sync` does, leaves a held plugin as it
  is, so a sync right after a start changes nothing. The Plugins list says what holds a plugin; its box
  still turns it on, which ends the hold as before.
* **The way back.** The desk's own keymap binds ⇧⌘X (Ctrl+Shift+X elsewhere) to `desk.plugins.open`
  for `endue.sidebar`: it opens the Plugins list from any desk and turns the list on when it is off.
  The list's status line names the key.
* **Setting values.** The runtime's first init.get, the first moment anything listens, brings one
  warning notice from `core` naming each value that fell back with its file and line; a later call
  tells only a value that is wrong in a new way.

### Consequences

* Good, because a kill, a segfault or a force quit is named at the next start, with its process and
  time, and `desk doctor` has something to show.
* Good, because `desk plugin sync` never undoes init.yaml, safe mode or a quarantine.
* Good, because no plugin setting can leave the desk without a way to turn plugins back on.
* Bad, because the first start of this version after an older one that was killed says nothing, and an
  older desk started on a newer last-start.json keeps it broken once (`quit` is a field it refuses).
* Bad, because a SIGTERM the desk does not handle counts as a run that did not quit.
* Bad, because the crash card's title stays "Desk crashed last time." for a kill too; the report says
  what happened.
* Bad, because `heldOff` is one more field in the bridge contract that every reader of plugin.list sees.

## More Information

Issue #163 (findings 10, 12, 13, 14). Code: `crates/desk-core/src/{last_start,lock,plugins,
settings_notice}.rs`, `crates/desk-crash/src/lib.rs`, `crates/desk-boot/src/{start,crash}.rs`,
`apps/desk/shell/src/{main,commands}.rs`, `packages/runtime/src/core/keys.ts`, `plugins/sidebar/ui/`;
spec `specs/bridge/v0/plugins.schema.json` (`PluginHold`). Tests: `crates/desk-core/tests/{last_start,
plugins_lock_holds,settings_notice}.rs`, `crates/desk-crash/tests/exit.rs`, `plugins/sidebar/tests/
rows.test.ts`, `packages/runtime/src/core/keys.test.ts`, `e2e/specs/{crash,settings}.spec.ts`. No section
of `docs/ko/desk-structure.md` changes.
