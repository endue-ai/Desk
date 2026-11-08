---
status: accepted
date: 2026-11-05
decision-makers: Team endue
---

# Eris remembers in files on this computer, with a search index derived from them

## Context and Problem Statement

Eris knew nothing once a session ended: a 200-line transcript in `brain.json` and nothing a person
could read, correct or delete. The roadmap's M2 (killer feature 4) asks for her own memory: facts and
preferences, episodes beyond a session, and working context, kept on the device, which an account later
carries to another computer. Where does memory live, in what shape, how is it found, and who may read
and write it?

## Decision Drivers

* A person can read every fact Eris keeps, correct it, and forget it, really (off the disk and the index)
* Memory stays on this computer; a later file sync carries it (ADR 0016's model), so no database is the truth
* Recall works offline and on the local brain, without embeddings
* Plugins and agents reach memory only through scopes the person controls (ADR 0072)

## Considered Options

* Files (`facts.yaml`, episodes by month as JSON Lines) plus a SQLite FTS5 index derived from them
* One SQLite database as the store and the index
* The item index (`desk-index`) with a new `memory` item kind
* Memory in endue AI only

## Decision Outcome

Chosen option: "files plus a derived index", because a person reads and edits YAML, a file sync can
carry text files, and the index can always be rebuilt from them.

* One folder per desk, `<data>/memory`: `facts.yaml` (a version and the facts; a line a person adds
  needs only `text` and gets an id when the desk reads it), `episodes/<YYYY-MM>.jsonl` (one episode per
  line, appended), and `index.sqlite` (FTS5, never synced). The index keeps the files' fingerprint and is
  rebuilt when it changes, so a hand edit or a synced file is found on the next call.
* Forgetting deletes from the file and the index in the same call. Ids (`fact_`, `ep_` and a
  time-ordered random suffix) sort by age and never collide across desks.
* `specs/memory/v0` holds the shapes; the bridge has `memory.list`, `memory.get`, `memory.search` under
  `memory:read`, and `memory.remember` (keep or edit a fact) and `memory.forget` (one, or all of a kind)
  under `memory:write`; `memory.changed` goes to the holders of `memory:read`. The caller is the writer:
  the runtime writes for the person, `agent:eris` is Eris.
* The app grants the runtime both scopes. Plugins declare them and are asked at first use. Eris gets
  them with her turns (#468). Working context is assembled per turn and never stored.
* The memory inspector (`plugins/memory`, `endue.memory`) is how people see, edit and forget memory.
* A new crate, `desk-memory`, owns the files and the index; rusqlite moves to the workspace's
  dependencies.

### Consequences

* Good, because memory is plain text a person owns, works offline and survives a lost index.
* Good, because sync later copies files; the derived index stays local.
* Bad, because two desks editing `facts.yaml` at once need a merge when sync arrives (M5).
* Bad, because word search misses synonyms; embeddings can come later beside the local brain.
* Neutral: `docs/ko/` design sources do not describe memory yet; the maintainers add it.
