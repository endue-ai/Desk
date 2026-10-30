---
status: accepted
date: 2026-10-30
decision-makers: Team endue
---

# Always grants live in one file on disk; session and once grants stay in memory

## Context and Problem Statement

`specs/bridge/v0/perm.schema.json` gives grants three durations: `once` (the next call it allows),
`session` (until Desk quits) and `always` (kept on disk across restarts). desk-core held every grant in
memory and answered `once` and `always` with `unsupported` (#73). Where do `always` grants live, in what
format, and what reaches the disk?

## Decision Drivers

* A grant the person gave "always" must survive a restart with the same `grantId`, so a permissions view
  and a plugin that remembered the id keep pointing at it
* Nothing the person did not choose to keep may reach the disk: start-up grants (`desk`, built-in
  plugins) are made again on every start
* One owner per piece of state, like `plugins.json` and `store.json`: no database, no second store
* A broken or missing file never stops Desk from starting

## Considered Options

* One JSON file of `always` grants in the data folder, rewritten whole on every change
* Every grant on disk, with a flag for the ones to drop at start
* `always` grants inside `store.json` under a reserved caller
* A grant log (append, compact on start)

## Decision Outcome

Chosen option: "one JSON file of `always` grants", because it keeps the split the spec draws (always =
disk, session and once = memory) visible in one place and costs nothing at start.

`Core::with_grant_file(path)` names the file; the app passes `data.join("grants.json")`, next to
`plugins.json`. Its format:

```json
{ "version": 1, "nextId": 7, "grants": [
  { "caller": "example.notes",
    "grant": { "grantId": "g3", "permission": { "permission": "fs:read", "paths": ["~/Documents/**"] },
               "duration": "always", "grantedAt": "2026-10-30T09:00:00Z" } } ] }
```

* `grants` holds `CallerGrant` values from the bridge spec, oldest first, `always` only. The file is
  rewritten whole (temp file and rename, `desk_sys::fs::write`) when an `always` grant is made or removed;
  a `session` or `once` grant never touches it, and `Core::grant` keeps making `session` grants.
* `nextId` keeps the id counter (the larger of it and the highest loaded id wins), so ids made after a
  restart never collide with loaded ones.
* A missing file, one that is not JSON, has another `version` or another shape starts empty; the next
  `always` grant rewrites it. A write that fails leaves the grant in memory for this run.
* `expiresAt` is never set: no v0 duration is timed.

What a duration means at a call: every permission check goes through `Core::check`, which uses a lasting
grant (`always`, `session`) before a `once` grant covering the same scope. A `once` grant is spent when a
call's check passes, before the call runs and whatever it returns; its holder hears `perm.changed
{ expired }`, and watches and subscriptions that no remaining grant covers end, as on a revoke (so one
started under a `once` grant ends with that call).

### Consequences

* Good, because the file is small, readable, and holds exactly what the person chose to keep; deleting it
  forgets every lasting grant and nothing else.
* Good, because the format reuses `CallerGrant`, so `perm.list` and the file say the same thing.
* Bad, because an unreadable file is replaced on the next `always` grant: grants written by a newer Desk
  are lost on a downgrade. They can be granted again.
* Bad, because the file is not shared between desks; syncing grants through endue would need its own
  decision.
* Bad, because the app keeps `always` grants in memory until it passes the file (#80 wires it).

## More Information

Issue #73 (desk-core serves every perm and events method). `crates/desk-core/src/grants.rs` (the file),
`perm.rs` (durations, the lasting-before-once rule), `core_perm.rs` (`check`). Prompting through
`perm.prompt` waits on the requester's thread, so hosts call `Core::handle` off their UI thread; until a
router reads addressed events (`EventBus::subscribe_addressed`) the `Prompter` decides, as before. No
section of `docs/ko/desk-structure.md` changes.
