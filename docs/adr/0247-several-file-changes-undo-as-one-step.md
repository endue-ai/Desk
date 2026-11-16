---
status: proposed
date: 2026-11-16
decision-makers: Team endue
---

# Several file changes undo as one step

## Context and Problem Statement

The explorer now selects several entries and pastes, drops or moves them all at once (#313). Each
`fs.rename` and `fs.copy` pushes its own entry on the desk's undo stack (ADR 0077, ADR 0125), so a
paste of five files took five Mod+Z to take back, and a Mod+Z in the middle left the person with half a
paste. How does one action of several file changes become one step for undo and redo?

## Decision Drivers

* One action of the person, one Mod+Z, whoever the caller is (the explorer, another plugin, an agent)
* Additive to bridge v0 (ADR 0004): old callers and old entries behave as before
* Each change stays its own call, with its own scopes, errors and conflict question
* No change ever loses a byte: an undo that fails stops, never half-overwrites

## Considered Options

* An optional `group` on `fs.rename` and `fs.copy`, carried by the undo entry; neighbouring entries of
  one caller with one group are one step
* Batch params (`moves: [{ from, to }]`) answered and undone as one entry
* No spec change: the explorer keeps one undo step per entry

## Decision Outcome

Chosen option: "an optional `group`", chosen by the person on #313, because it is the smallest
additive change: the calls, scopes and errors stay as they are, a caller names the action it is part of,
and the stack does the rest.

* **Wire.** `FsRenameParams` and `FsCopyParams` take `group` (`UndoGroup`: a string of 1 to 128
  characters, `invalid_params` otherwise, before anything changes). `UndoEntry.group` carries it.
* **One step.** cmd.undo undoes the newest entry and then, while the next is a file operation of the
  same caller with the same group, that one too, newest first; cmd.redo redoes them oldest first. One
  `cmd.undone` names the newest. Anything between two entries of a group (another caller's change, an
  ungrouped one) splits it.
* **Failures.** An entry that is refused or fails stays on its side with those under it, the ones
  already undone stay undone, and the answer is its error, so a second Mod+Z goes on where it stopped.
* **The explorer.** Each drop and each paste makes one group, unique across reloads
  (`drop-<time>-<n>`). Trash stays as it is: the desk cannot undo it, so trashing several asks once and
  the OS Trash keeps every entry.

### Consequences

* Good, because a paste or a drop of many entries is taken back and redone with one Mod+Z.
* Good, because every caller and every old entry works unchanged; a caller that sends no group gets
  one step per change, as before.
* Bad, because a group is only as good as its caller's names: a caller that reuses one name for two
  actions joins them when nothing comes between.
* Bad, because a failure in the middle of a group leaves part of it undone; the person sees why and
  undoes again, but the files are briefly half way.
