---
status: proposed
date: 2026-11-07
decision-makers: Team endue
---

# Files are renamed, copied and trashed through the bridge, with undo

## Context and Problem Statement

The person asked for drag and drop between plugins that moves files or hands over paths (#518, #544),
and the Explorer needs Rename, New Folder and Move to Trash. desk-sys has the primitives (`stat`,
`mkdir`, `rename`, `copy`, `trash`, #509), but the bridge offered only `fs.read`, `fs.list`,
`fs.write`, `fs.watch`, `fs.url`, `fs.history` and `fs.restore`. How do callers rename, move, copy,
make folders and trash files, under which permissions, and how does the desk take it back?

## Decision Drivers

* No call loses a byte: nothing overwrites, nothing deletes for good
* The permission model stays: fs scopes and grants, no new permission names
* One Mod+Z: the desk's undo stack (ADR 0077) reverses these changes as it reverses writes
* Method names #544 can code against now, additive to bridge v0 (ADR 0004)
* Tests never touch the OS trash of whoever runs them

## Considered Options

* Five bridge methods (`fs.stat`, `fs.mkdir`, `fs.rename`, `fs.copy`, `fs.trash`), undone by inverses
  the core runs itself
* One `fs.op { kind, ... }` method
* Commands of a built-in plugin (`desk.files.rename`, ...) with `undo` in its manifest
* Callers composing `fs.read`, `fs.write` and a delete

## Decision Outcome

Chosen option: "five bridge methods", because each is one primitive with its own params and result
types, the permission of each end is plain in its params, and the undo stack already has a core-run
inverse (a write's `fs.restore`) to stand beside.

* **Permissions.** `fs.stat` needs `fs:read`. `fs.mkdir` and `fs.trash` need `fs:write`; with
  `parents`, every folder mkdir would create must be inside the scope too. `fs.rename` needs
  `fs:write` on both ends: `scope` covers `to`, and `from` too unless `fromScope` covers it (two grants,
  one per folder). `fs.copy` needs `fs:read` on `from` (`fromScope`) and `fs:write` on `to` (`scope`).
  Both ends' scopes are checked against their paths before any grant is, so a refusal at one end spends
  no `once` grant at the other.
* **Never an overwrite.** A name already taken is `already_exists`, from desk-sys, which checks before it
  renames and builds a copy under a temp name before it renames it into place. Missing paths are
  `not_found`, a folder put into itself `invalid_params`, and the home folder and the roots are never
  created, moved or trashed (`invalid_params`).
* **The trash is the only removal.** `fs.trash` moves to the OS trash; when there is none, or it
  refuses, the answer is `unsupported` and the path stays. A rename across volumes copies, then trashes
  the source, and answers `crossedDevices: true`; if the trash refuses, the copy it just made is removed
  (the source still holds every byte) and the answer is the trash's error.
* **Undo.** A rename pushes `{ command: fs.rename, args: { from, to }, inverse: fs.rename }`, undone by
  renaming back. A copy pushes `{ command: fs.copy, args: { from, to }, inverse: fs.trash }`, undone by
  trashing the copy. A mkdir pushes `{ command: fs.mkdir, args: { path, parents }, result: { created },
  inverse: fs.rmdir }`, undone by removing the folders it created, innermost first, while they are
  empty (the OS's rmdir checks): a folder that holds something is `invalid_params` and stays.
  `fs.rmdir` only names that inverse for `cmd:invoke` scopes; it is no bridge method. `cmd.undo`
  runs these inverses itself, as it restores a write, and `cmd.redo` runs the operation again. An undo
  that would overwrite is `already_exists`, and the entry stays on the stack. A trash pushes nothing:
  restoring from the OS trash is the OS's.
* **Agents are not held.** ADR 0078 holds an agent's irreversible calls for the person. None of these
  five loses a byte (what they change comes back through `cmd.undo` or the OS trash), so they pass on
  the agent's grants and allowlist alone.
* **A trash seam.** `Core::with_trash` replaces the OS trash, as `with_opener` replaces the system
  opener, so tests use a folder of their own; one test reaches the freedesktop trash in a child process
  with its own `XDG_DATA_HOME`.

### Consequences

* Good, because drag and drop, the Explorer and agents move and copy files with one call each, and
  the person undoes any of them with the same Mod+Z as a write.
* Good, because the permission model is unchanged: a plugin's manifest fs permissions already say
  what it may rename or copy.
* Bad, because a rename's undo runs under `cmd:invoke` only, as a write's restore does: whoever may
  invoke `fs.rename` through the stack can move a file back that it holds no fs grant for.
* Bad, because a move across volumes leaves the original in the trash rather than gone, so it takes
  space there until the person empties it.
* Bad, because an undo of a copy fills the OS trash, and a trash cannot be undone by the desk.

## More Information

Issue #553 (the bridge half of #518). `specs/bridge/v0/fs.schema.json`, `crates/desk-core/src/
core_fs/` (`ops.rs`, `moves.rs`, `undo.rs`, `trash.rs`), `core_undo.rs` (the hand-off),
`crates/desk-core/tests/fs_ops.rs`, `packages/runtime/src/bridge/fs.ts` (the stub's file tree).
Explorer actions stay in #518; drag to move and Alt-drag to copy land in #544. `desk:host` for logic
plugins (`specs/wit/desk-host.wit`) and the CLI do not offer these yet.
