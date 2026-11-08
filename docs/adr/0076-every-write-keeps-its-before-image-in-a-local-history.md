---
status: accepted
date: 2026-11-02
decision-makers: Team endue
---

# Every write keeps its before-image in a local history

## Context and Problem Statement

Plugins, agents and the CLI all write files through one bridge call, `fs.write`. desk-sys writes
atomically (a temp file renamed over the target), but nothing keeps the bytes it replaces: a note saved
over, a file an agent rewrote or a restore gone wrong cannot be taken back, and command undo is an open
question in `docs/ko/desk-requirements.md`. Where does the desk keep what its writes replace, in what
form, and how do callers get it back?

## Decision Drivers

* The person gets the previous bytes back whoever wrote, without each plugin doing anything
* A missing or broken history never stops Desk from starting (ADR 0029's rule for the grant file)
* Bounded: the history cannot fill the disk, and old versions go first
* Readable without Desk: plain files in the data folder, no database
* A write still leaves the old file or the new one, never a mix, whenever the process dies
* Additive to bridge v0 (ADR 0004); `fs.write` gains no argument

## Considered Options

* Content-addressed blobs and one JSON index per path in the data folder, kept by the core on every
  `fs.write` over a file whose bytes differ
* One append-only log of every write, compacted on start
* The item index's SQLite file (ADR 0033)
* Backup copies beside each file (`a.md~`, as Emacs does)
* Each writing plugin keeps its own undo

## Decision Outcome

Chosen option: "content-addressed blobs and one JSON index per path", because it keeps every version
once however many paths share it, rewrites only the index of the path that changed, and a broken index
costs only that path's history.

`Core::with_history_dir(dir)` names the folder; the app passes `data.join("history")`, next to
`store.json`. Before `fs.write` (and `fs.restore`, which writes through it) overwrites a regular file
whose bytes differ, the core streams the file into `objects/<sha256>` (temp file and rename), adds a
version to `paths/<sha256(path)>.json`, then writes as before. The path is the file's folder resolved to
its real path, so `~/a.md` and `/Users/me/a.md` share one history. The index:

```json
{ "version": 1, "path": "/Users/me/notes/a.md",
  "versions": [{ "id": "1793520000000-3fa9c1", "at": "2026-11-02T09:20:00Z", "caller": "endue.notes",
                 "size": 42, "sha256": "9f86d0..." }] }
```

* A version is what one write replaced: `at` is when that write ran, `caller` whose write it was.
  Its id is the Unix time in milliseconds (one more than the last id when the clock repeats) and six
  random hex digits, so ids order versions desk-wide. `versions` is newest first.
* `fs.history { path, limit? }` lists them under `fs:read`; `fs.restore { path, version }` writes one
  back under `fs:write`, so what it replaces is kept as a version too. `fs.write` and `fs.restore`
  answer the id of the version they kept as `version`. A new file and unchanged bytes keep nothing.
* desk.files' `history-max-versions` (50 per path) and `history-max-bytes` (256 MiB of blobs, each
  counted once) bound it, read on every write: the path's oldest versions go past the first, the
  oldest desk-wide past the second, and a blob goes once no index names it. A file larger than the
  byte budget is written without a version and the core logs a warning.
* On start the core reads every index. One that is not JSON, has another version or names another
  path is renamed `<name>.broken` and the core logs one warning on its `core` channel; that path
  starts empty. Blobs no index names and temp files are removed. Nothing here fails the start.
* If the write fails after its version was kept, the version is taken out again. A process killed
  between the index and the rename leaves a version equal to the file: harmless.
* The CLI reaches it as `desk fs history <path>` and `desk fs restore <path> <version>`; the app grants
  `cli` `fs:read` and `fs:write` over `/**` and `~/**`, since whoever can open the socket is the same OS
  user who owns those files (ADR 0030). Logic plugins and connectors import `fs.history` and
  `fs.restore` from `desk:host` under their manifest's fs permissions.

### Consequences

* Good, because every writer is covered at once, and undo (#276) can restore any write without
  plugin code.
* Good, because the files explain themselves: deleting `history/` forgets every version and nothing
  else.
* Bad, because every overwrite reads the old file once more and writes it once to `objects/` when its
  content is new: the cost of a save roughly doubles for large files.
* Bad, because only the desk's own writes are kept: an edit in another app is not, until the next desk
  write keeps the result as a version.
* Bad, because a version holds the whole file; a large file edited often spends the byte budget fast
  and pushes other files' versions out first.

## More Information

Issue #275. `crates/desk-core/src/history.rs` (versions in memory, pruning), `history_index.rs` (the
files), `core_history.rs` (fs.history, fs.restore, the write that keeps), `specs/bridge/v0/fs.schema.json`
(`FsVersion`), `specs/wit/desk-host.wit`. The design's file section in `docs/ko/desk-structure.md` gains
the history next to `store.json` when it is next revised.
