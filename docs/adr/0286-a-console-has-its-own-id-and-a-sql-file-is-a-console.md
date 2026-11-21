---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# A console has an id of its own, and a .sql file is a console bound to it

## Context and Problem Statement

`endue.database` had one console per connection: its text kept in the store under the connection's
id (`console:<connection>`), its parameters remembered by connection, its history entries by
connection, and the surface state kept only the connection on screen. The PostgreSQL plan (#438)
wants as many consoles per connection as the person opens (PG-24, #457), and PG-02 (#442) then
keeps a PostgreSQL session per console (ADR 0281), so a console needs an identity that is not its
connection's and not its desk buffer's (the desk gives a new buffer id after each restart). The same
task makes a `.sql` file something the plugin opens: from the desk's opener, from a drop, and run
from disk at any size. How is a console named, kept and brought back, how does a file become one,
what may the plugin write, and how does a script larger than the editor run while each run is still
one `psql` process with its statements as arguments (ADR 0038)?

## Decision Drivers

* An id a session can attach to (PG-02), stable across restarts
* The one console an older version kept comes back with its text, with no migration step
* A file is written only where the person saved it, and only after they were asked (ADR 0260)
* A script of any size runs without being loaded into the editor or the store
* Each run of a file is a console run under every guard of one (read-only, production, dangerous)
* Changes to the editor's files stay out of this task (PG-04, #444)

## Considered Options

* Console id: a connection's first console takes the connection's id and the others a random
  `k-<10 base-36>` id; or every console a random id, with a migration of the old key; or the desk
  buffer's id
* The kept list: in the surface state (`consoles: [{ id, connection, number, title? }]`); or one store
  key per console
* A file's console: the desk's buffer for the file (`desk.files.visit`, `desk.files.save`), a dropped
  file in a buffer opened with its path; or a console that imports the text and forgets the file
* Saving: `fs:write` of `/**` declared, asked for each file at its first save; or a save dialog
  through the desk; or no save
* A file larger than the editor: parts of at most 192 KiB and 1,500 statements, cut only between
  statements outside a transaction, the session settings carried into each; or the whole file in
  one run; or refused until PG-02

## Decision Outcome

Chosen: the first of each.

* The first console keeps `console:<connection>`, so the text an older version kept is that
  console's text, unchanged; other consoles key their text, parameters and history entries (an
  entry's `console`) by their own id. Its name is the connection's, numbered (`Shop 2`, the smallest
  free) or renamed (`Shop · Audit`). Closing an extra console forgets its text; closing the first
  keeps it, as the one console's was kept.
* The surface state lists the consoles the plugin opened, and the one on screen; a state without
  the list (an older version's) opens the console of `current`, as before. A file's console comes
  back with the desk's own files, as a SQLite file does.
* A `.sql` file is a console in the buffer the desk lists as that file. It runs on the connection the
  file remembers (store `sql-files`, the last 200), else for a drop the console on screen's, else
  the one picked, and a run without one asks first. An edit marks the buffer unsaved; Save writes
  that path only, under `fs:write` of `/**`, which grants nothing at install and only lets the plugin
  ask (ADR 0260); `fs.watch` hands a change on disk to the desk (`desk.files.changed`), which asks
  before unsaved edits are replaced.
* Text past what the store keeps (60 KiB of a value's 64 KiB) is kept whole in
  `~/.endue/database/consoles/<id>.sql` under a declaration granted at install, and the store says
  where.
* Database: run a .sql file reads the file in 256 KiB ranges as bytes, cuts it as the console cuts a
  script wherever a range ends, and runs each part as a console run, so every guard asks per part.
  A part never cuts a transaction (one larger than 448 KiB or 3,000 statements is refused at its
  line); `SET`, pg_dump's `set_config(..., false)` and SQLite's assigning `PRAGMA` before a part run
  again at its start, `RESET` and `SET LOCAL` excepted. The first error stops the file at its line.

### Consequences

* Good, because PG-02 attaches a session to `consoleId` with nothing else to change, and an upgrade
  loses no text.
* Good, because the plugin never writes a file the person did not save, and asks once per file.
* Good, because a dump of any size runs with flat memory, its progress on the status line.
* Bad, because until PG-02 a file's parts are separate sessions: a temporary table or a prepared
  statement does not outlive its part, and only the settings listed above are carried.
* Bad, because on a production connection, or with dangerous statements, a large file asks once per
  part. One ask for the whole file waits for a run that is one session.
* Bad, because `fs:write` of `/**` widens what the manifest may ask for; it still grants nothing.

## More Information

PG-24 (#457), epic #438; ADR 0038 (one client per run), ADR 0131 (the opener's read grant), ADR 0260
(declarations bound asks), ADR 0281 (sessions in the core). Code: `plugins/database/ui/console-list.js`,
`console-many.js`, `console-text.js`, `console-files.js`, `features/consoles/`.
