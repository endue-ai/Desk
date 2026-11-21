---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# SQL problems are checked in the parse worker against the schema cache, and never told where it cannot tell

## Context and Problem Statement

PG-30 (#460) underlines a PostgreSQL console's problems as the person types: SQL the server cannot
parse, and names that bind to nothing. The plugin already has the server's grammar in a worker
(ADR 0283), a resolver that binds names to a schema model, a schema cache of every read schema
(ADR 0285) and a vendored CodeMirror (ADR 0282). Where does the check run, what does it know,
and when does it say nothing? A false underline teaches the person to ignore all of them.

## Decision Drivers

* The server's own message and position, so the underline agrees with what a run refuses
* A 1 MB script stays responsive: nothing heavy on the frame's main thread, only changed
  statements parsed again, a stale answer never drawn
* No catalog query for what the cache holds; an unread schema is never reported as missing
* The editor's shared files only register the extension (PG-31 completion is next to it)

## Considered Options

* A check in the parse worker against the cached schema, through @codemirror/lint
* Asking the server: PREPARE or EXPLAIN of each statement on the connection
* The check on the page's thread, on the trees the worker answers
* A lint panel and underline of our own instead of @codemirror/lint

## Decision Outcome

Chosen option: "a check in the parse worker against the cached schema, through @codemirror/lint",
because the grammar and the resolver are already there, and the trees never cross to the page.

* `ui/diagnose/check.js` is the worker's request `check`: the script cut by the plugin's splitter,
  each statement parsed alone, a syntax error at the parser's cursor with its message (a point
  past the last token at the end of input), then names bound by `ui/sql/parse/resolve.js` under
  the search path the statements before it left. Each console keeps its statements keyed by text,
  model, path and what came before, so an edit parses only what changed.
* What the script does counts for what follows (`script.js`): SET and RESET search_path,
  `set_config`, CREATE TABLE with its columns (unknown with IF NOT EXISTS, which may keep another
  table), CREATE VIEW, SEQUENCE, TABLE AS and SELECT INTO with columns unknown, ALTER TABLE and
  RENAME COLUMN leaving the columns unknown, RENAME and SET SCHEMA, CREATE SCHEMA.
* Messages are the server's (`relation "x" does not exist`, `column p.x does not exist`,
  `missing FROM-clause entry for table "x"`, INSERT's counts, VALUES lengths), with the search path
  the check used and a hint: the nearest name (at most three edits, the server's rule) or the
  schemas off the path that hold it. The live test holds every message and position to a real
  server's.
* Partitions, which the cache reads under their root table (ADR 0295), are relations of the
  schema each lives in, with the root's columns.
* Never told: a schema the cache did not read; a function (the cache leaves out aggregates, window
  functions and extension members), only its schema; system columns; DROP or ALTER IF EXISTS; any
  name after DO, CALL, `\c` or `\i`; the schema CREATE EXTENSION or IMPORT FOREIGN SCHEMA fills;
  psql's meta-commands and statements with `:name`, `:'name'`, `:"name"` or `?`. A statement the
  server ran takes its answer until its text changes.
* The page (`diagnose/editor.js`) is @codemirror/lint 6.9.7, added to the vendored bundle: a
  300 ms pause, nothing sent during an IME composition, one check in flight per console with the
  newest waiting (`requests.js`), and a result dropped if the text moved. F8 and Shift+F8 go to the
  next and previous problem and say it on the status line; Mod+. opens the component's list, a
  listbox named "Problems". Settings `problems-syntax` and `problems-names` turn each kind off.
* Measured on a development laptop: in a Node worker thread, 1 MB (about 8,600 statements) checked
  in 280 to 300 ms the first time and 55 to 65 ms after an edit (budget 2 s and 300 ms,
  `tests/problems-incremental.test.ts`); in Chromium, typing into a 1 MB console while it is
  checked, the frame's longest task was 23 to 26 ms, p95 11 to 15 ms (budget 100 ms,
  `e2e/database-problems.spec.ts`).

### Consequences

* Good, because an underline is where and what the server would say, and the frame never parses.
* Good, because a new check (PG-31's completion, later lint rules) reads the same per-statement
  state in the same worker.
* Bad, because the resolver is ours: a construct it does not bind is either missed or, if wrongly
  bound, a false underline until it is fixed; the live corpus guards the common ones.
* Bad, because a schema the cache has not read is silent, and a stale cache can underline a table
  created in another session until the cache's fingerprint check reads it again. A partition whose
  root table is in a schema the cache did not read is not known either, and is underlined until that
  schema is read.
* Bad, because the bundle grows by about 16 KB for @codemirror/lint.

## More Information

Issue #460 (epic #438). ADR 0282 (editor), 0283 (parser and resolver), 0285 (schema cache), 0295
(the cache's partitions and other kinds).
`plugins/database/ui/diagnose/README.md`, `plugins/database/docs/features.md` (SQL problems).
