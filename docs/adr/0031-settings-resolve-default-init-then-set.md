---
status: accepted
date: 2026-10-31
decision-makers: Team endue
---

# Settings resolve the manifest default, then init.yaml, then the set value; the log is a ring and two files

## Context and Problem Statement

`specs/bridge/v0/{settings,log}.schema.json` define `settings.*` and `log.*`, and desk-core answered
them `unsupported` (#81). Setting layers lived only in the runtime's `settings.ts` (ADR 0017), so the
CLI, logic plugins and agents could not read a setting, and nothing kept a log but `eprintln!`. Which
layers does the core resolve and in what order, who owns a key, where do set values and the log live
on disk, and how big may the log grow?

## Decision Drivers

* One answer for a setting, whoever asks: the runtime, a plugin, the CLI or an agent
* The person's own words are init.yaml (ADR 0016), and Desk never writes init.yaml (ADR 0017)
* Keys belong to their owner, like the store; reading another owner's needs a grant
* A log that a person or the CLI can read after a crash, bounded on disk and in memory, without
  secrets in it
* One owner per piece of state and no new dependency, like `store.json` and the grant file

## Considered Options

* Resolve manifest default < init.yaml < set value in the core; the runtime keeps the profile and
  session layers above
* Resolve manifest default < set value < init.yaml, so a hand edit always wins
* Serve only set values and leave every layer in the runtime
* Settings inside `store.json` under a reserved caller; the log in the item index or in `store.json`

## Decision Outcome

Chosen options: "manifest default < init.yaml < set value" and "a ring plus two rotated files",
because a value set while Desk runs is the latest thing the person asked for, ADR 0017 already put
`settings.*` values between init.yaml and the profile, and both stay readable without Desk.

* **Ownership.** A key belongs to the caller that sets it; its full name is `owner.key`, as
  init.yaml and `contributes.settings` write it. A caller reads its own keys without a scope; another
  owner's need a `settings:read` scope covering `owner/key` (`*` matches within each side of the
  `/`). `settings.changed { owner, key, value }` follows every successful set, to the owner and to
  subscribers whose `settings:read` grant covers it.
* **Resolution**, lowest first: the default the installed plugin `owner` declares in
  `contributes.settings["owner.key"]` (enabled or not; names outside its own id are ignored), then
  init.yaml's `settings["owner.key"]` as in force (what `init.get` hands out, unchanged), then the
  set value. `settings.list` lists the union of the three for each owner it covers, by owner then
  key; an init.yaml name goes to the longest known owner it starts with. The profile and session
  layers stay in the runtime and move onto these methods in a later task. Values are not checked
  against a setting's `kind` or `choices` yet.
* **Set values** live in `settings.json` in the data folder, next to `store.json`, in the store's
  shape `{ owner: { key: value } }`, 64 KiB of JSON per value, rewritten on every set
  (`Core::with_settings_file`).
* **The log.** One channel per caller, `core` for desk-core (`Core::log`). The core stamps `at` with
  milliseconds and replaces the value of any field whose name contains `token`, `secret`, `password`,
  `passwd`, `authorization`, `cookie`, `apikey`, `api_key` or `api-key` with `"***"`, at any depth,
  before the entry is kept or published. One ring of the latest 10 000 entries over every channel
  serves `log.tail`; `desk.log` in the logs folder (`Core::with_log_dir`) holds the same entries as
  JSON Lines, appended per write without fsync. When it would pass 4 MiB it becomes `desk.log.1`,
  replacing the one before, so there are at most two files. At start the ring is filled again from
  `desk.log.1` then `desk.log`, skipping lines that do not parse.

### Consequences

* Good, because every caller resolves a setting the same way, and the CLI and plugins can read the
  setup without the runtime.
* Good, because `settings.json` and `desk.log` are plain JSON a person can read, and deleting either
  forgets only what it holds.
* Good, because the log is bounded: 10 000 entries in memory and about 8 MiB on disk.
* Bad, because a value set while Desk runs hides a later edit of the same key in init.yaml until it
  is set again; a reset method would need a spec change.
* Bad, because masking by field name misses a secret inside a message or under an innocent name.
* Bad, because two files of 4 MiB hold fewer than 10 000 entries when entries are large, so a
  restart can bring back fewer than the ring held.
* Bad, because the app keeps settings and the log in memory until it passes the file and the folder
  (a later task).

## More Information

Issue #81. Code: `crates/desk-core/src/{core_settings,core_log,log,perm,time}.rs`; tests:
`crates/desk-core/tests/{settings,log}.rs`. ADR 0016 (init.yaml), ADR 0017 (setting layers in the
runtime), ADR 0029 (grants on disk). No section of `docs/ko/desk-structure.md` changes.
