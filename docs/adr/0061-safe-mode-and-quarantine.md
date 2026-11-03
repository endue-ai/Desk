---
status: accepted
date: 2026-11-02
decision-makers: Team endue
---

# Safe mode and quarantine: the desk starts with whatever is left

## Context and Problem Statement

Every feature of the desk is a plugin, and any plugin combination must boot (CORE-09 in
`docs/ko/desk-requirements.md`). Until now a plugin that killed the start killed every later start
too, a UI frame that threw on mount came back at every start, and a state file that would not parse
started empty and was overwritten by the next save, with nothing said. How does the desk get back up
on its own, and how does it tell the person what it left out?

## Decision Drivers

* A desk that keeps dying before it is ready must start the next time without the person editing files
* Nothing the person had is lost: no state file is overwritten because it could not be read
* The person hears about each thing once, with the action that fixes it
* What the desk does for one run must not become a choice the person never made (plugins.json)

## Considered Options

* Safe mode and quarantine as holds for this run, decided at start from the data folder
* Turning failing plugins off with `plugin.setEnabled false`, remembered in plugins.json
* Automatic bisection over the plugins that were on
* Doing nothing automatically: a `--safe` flag and documentation

## Decision Outcome

Chosen option: "holds for this run", because it brings the desk up without making choices on the
person's behalf, and every hold ends the moment the person turns the plugin on.

* **Safe mode** runs only the desk's own policy plugins (kind `policy`, id `desk.*`) and the shell's
  system layer. It comes from `--safe` or `DESK_SAFE=1`, or by itself when last-start.json says the two
  starts before did not reach the ready line within 60 s: the app writes `{ at, pid, phase, failed }`
  at start, marks it `ready` (or `late`) at the ready line, and `failed` counts the starts in a row that
  did not make it. Every other plugin, libraries included, is held off; desk.session neither restores
  nor saves. The shell shows a "Safe mode" badge whose "Start normally" starts the binary again without
  the flag, and a crash-loop start names the plugins it held off.
* **Quarantine**: a frame that fails to start (mount throws, or the frame throws before its first
  `desk:ready`) three starts in a row is listed in `desk`'s store under `plugins.quarantined` as
  `{ id, version, at }`. The core holds it off at later starts while that version is installed; a new
  version or the person turning it on lets it go. The notice offers "Turn on again".
* **State files** (store, settings, grants, plugins, secrets, sync, brain, last-start, the item index,
  view files that are not YAML, and the runtime's own records in the store) follow one rule when
  unreadable: start empty, keep `<name>.broken`, one notice naming the file with "Show in file
  manager". `desk doctor` lists quarantined plugins and `.broken` files without a running desk.

### Consequences

* Good, because a crash loop ends after two starts, and a broken file or plugin costs the person a
  notice, not their data or their desk.
* Good, because plugins.json only ever holds what the person chose; holds disappear with a new version.
* Bad, because a slow machine whose first two starts take over 60 s lands in safe mode once.
* Bad, because a frame that hangs without throwing is not a failed start; the watchdog (#272) covers it.
* Bad, because the runtime gets start information through two Tauri commands (`desk_start`,
  `desk_relaunch`) rather than the bridge, so other hosts must supply it themselves.

## More Information

Issue #271; the watchdog and rate limit follow in #272, the soak and chaos layer in #273.
`docs/ko/desk-structure.md` gains the start sequence (CORE-09) when the design document is next revised.
