---
status: accepted
date: 2026-10-28
decision-makers: Team endue
---

# A person's setup lives in init.yaml; the core syncs it through endue

## Context and Problem Statement

Emacs reads `init.el` at every start, and people carry that one file from machine to machine. Desk's
design names its boot config "modes (a plugin set plus settings)", but there was no file a person
could read, edit and take to another desk. The setup should follow the person through their endue
account. endue does not serve sync yet, but the core's half of it (what to push, what to pull, what to
do when both sides changed, what to do offline) can be built and tested now.

## Decision Drivers

* People read and edit their setup by hand, with comments, like `init.el`
* Every desk of a person starts the same way, and no edit made on either side is lost
* The core owns sync, as it owns the brain conversation (ADR 0014); plugins never hold credentials
* endue's server arrives later without changing the core's sync logic
* Offline is a normal state

## Considered Options

* `~/.desk/init.yaml`, synced as a whole file by desk-core behind a `SyncRemote` trait, with a mock
  remote until endue serves sync
* JSON or TOML in the app data folder
* Settings as keys in core storage (`store.json`), synced key by key
* Wait for endue's sync API and add the file then

## Decision Outcome

Chosen option: "`~/.desk/init.yaml`, synced as a whole file", because YAML takes comments, a file
under home is where people look for it (like `~/.emacs.d/init.el`), and whole-file sync keeps the
person's comments and layout as they wrote them.

* File: `~/.desk/init.yaml`, or the file `DESK_INIT` names. A missing file is written from the
  template. A file that does not parse is never overwritten: the defaults (or the last setup that
  parsed) stay in force, and the reason is reported.
* Format v0: `version`, `mode`, `plugins.disabled`, `settings` (key to any JSON value) and
  `sync.enabled`. Unknown keys are ignored, so an older desk reads a newer file; a higher `version` is
  refused. Plugins in `plugins.disabled` start disabled without changing their persisted flag.
* Sync compares three versions: the file, endue's copy (with a revision) and the base, the last
  version both agreed on (revision and digest, in `sync.json` in the data folder). The side that
  changed since the base wins. When both changed, nothing is overwritten: endue's copy is saved as
  `init.remote.yaml` and `resolve_init(Keep::Local | Keep::Remote)` settles it. A desk that never
  synced and holds only the defaults takes endue's copy. A file that does not parse is neither pushed
  nor pulled. A push names its base revision, and a push from a stale base becomes a conflict.
* Until endue serves sync, `MockRemote` keeps "endue's" copy in `sync-mock.json` in the data folder.
  The app syncs once at start, before plugins install.

### Consequences

* Good, because init.yaml is plain text: people diff it, comment it and keep it with their dotfiles.
* Good, because the sync rules and the conflict path are tested now (`crates/desk-core/tests/sync.rs`).
* Good, because the endue client only has to implement `SyncRemote`: pull, and push with a base.
* Bad, because the unit is the whole file: edits to different keys on two desks conflict, not merge.
* Bad, because nothing calls `resolve_init` yet; a UI or bridge method comes later (spec first).
* Bad, because plugins cannot read `settings` yet; that also needs a bridge method.
* Bad, because the core gains a YAML parser (`yaml_serde`).
* Bad, because sync runs only at start; the real client needs a short timeout so start-up never
  waits on the network.

## More Information

When endue serves sync, its operations go into `specs/` first (for example `GET /init`, and
`PUT /init` with the base revision, answering 409 with endue's copy when the base is stale), then a
client implements `SyncRemote` and the app swaps `MockRemote` for it. In `docs/ko/desk-structure.md`,
the boot-config row of "Emacs 처럼, 하나의 OS 처럼" should name `init.yaml`.
