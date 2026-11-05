# Desk memory v0

Eris's memory on this computer (ADR 0095). Three layers: **facts and preferences** (words a person can
read and edit, kept by people and by Eris), **episodes** (what was asked, done and answered in a turn,
kept beyond its session) and **working context** (what is open now, assembled for each turn and never
stored; its shape for the brain comes with Eris's turns, #468). `memory.schema.json` holds the stored
layers; the bridge reads and writes them with `memory.*` (`specs/bridge/v0/memory.schema.json`) under
`memory:read` and `memory:write`. v0 may break on any minor release (ADR 0004).

| Definition | Meaning |
| --- | --- |
| `MemoryFact` | `kind: fact`, `id`, `text`, `by` (who kept it), `at`, `updated?`, `tags?` |
| `MemoryEpisode` | `kind: episode`, `id`, `at` (when the turn ended), `by`, `asked`, `answered`, `steps?` (`{ command, ok }`) |
| `MemoryEntry`, `MemoryHit` | A fact or an episode; a search hit is an entry and the words around the match |
| `MemoryFactsFile`, `MemoryFactLine` | `facts.yaml`: `version: 0` and the facts; a line a person adds needs only `text` |

Ids are `fact_` or `ep_` and a time-ordered suffix, so they sort by when they were made and two desks
never pick the same one. The writer `by` is `person` (the desk's own screens), `eris`, a plugin id or
`agent:<id>`.

## On disk

One folder per desk, `<data>/memory` in the app, made for a later file sync (ADR 0016's model):

| File | Holds |
| --- | --- |
| `facts.yaml` | The facts, oldest first. Hand edits are read on the next call; lines without an id get one and are written back |
| `episodes/<YYYY-MM>.jsonl` | One `MemoryEpisode` per line, appended; forgetting rewrites the month without the line |
| `index.sqlite` | Full-text search (SQLite FTS5) derived from the two above; rebuilt when they change; never synced |

Forgetting removes an entry from its file and from the index in the same call.
