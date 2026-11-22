---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# Two schemas compare by their normalized DDL, and a schema dumps to one file per object

## Context and Problem Statement

PG-53 (#477) asks that `endue.database` compare any two of: a schema on a connection, a schema on another
connection, a folder of DDL files and a saved snapshot. It lists what exists on one side only and what
differs, writes a migration script for the direction and the objects chosen, and dumps a schema to a folder
for version control or saves it as a snapshot. Formatting, order and generated names must not count as
differences. A folder is read from text the plugin did not write, and a server is read from its catalog:
what do the two sides compare as, which formats do the folder and the snapshot take, and how is the script
written so that it does not grow a second DDL writer beside the table form's (PG-51, ADR 0324)?

## Decision Drivers

* A schema dumped and read back, or saved and opened, compares equal to the schema it came from
* Formatting, order, the schema's own name and server-generated names never show as differences
* One DDL writer: a changed table is altered by the same steps the table form writes
* A script runs only through the plugin's guards, and only when the person runs it

## Considered Options

* Compare a model of objects, each with its DDL as the plugin writes it and a normalized signature
* Compare catalog rows (both sides read from a server; a folder applied to a scratch schema first)
* Compare dump text, line by line

## Decision Outcome

Chosen option: "a model of objects with normalized signatures", because a folder and a snapshot read into
the same model a server does, without a scratch schema to write in, and the table form's design is already
that model for tables.

* A model is `{ format: 1, schema, objects }`; an object has a kind (type, sequence, function, table, view,
  materialized view, trigger), a name (a function's carries its argument types, a trigger's its table) and
  its DDL. A table also keeps its PG-51 design; a function its body and arguments; an enum its labels.
* Two objects are the same when their signatures are. A signature is the DDL lexed by the plugin's own lexer
  with comments and space dropped, keywords and unquoted names folded, needless quotes, the own schema's
  qualifier (also inside a `regclass` literal) and one pair of outer parentheses removed, dollar-quoted bodies
  normalized the same way. A table's signature lists its columns by name, its constraints and indexes by
  what they hold, and leaves out a name PostgreSQL generates (`<table>_..._pkey|key|fkey|check|idx|excl`).
* The script makes the target like the source. A table is aligned to the target (columns by name, parts by
  what they hold, the target's names kept where one side's name is generated) and altered by PG-51's
  `alterSteps`; a new one is PG-51's `createSteps` without its foreign keys, added after every new table.
  Other kinds are ordered by what their DDL names, a cycle broken by kind and name. What it will not write
  (an enum value removed, a domain or composite type changed, a type change with no cast, a table that did not
  read) is held: said at the top, and Run waits.
* The folder: `<kind folder>/<name>.sql` under `types`, `sequences`, `functions`, `tables`, `views`,
  `materialized-views` and `triggers`; a name that is not plain lower case gets `-<hash>` so two names never
  share a file. Each file is the object's DDL as the plugin writes it, schema-qualified, ending in a newline.
  A dump moves `.sql` files no object holds any more in those folders to the trash and leaves others alone.
* The snapshot: one JSON file `{ "format": "endue.database.schema", "version": 1, "schema", "from",
  "saved", "objects" }`. A newer version or another format is refused in words.

### Consequences

* Good, because a folder in version control, a snapshot and a live schema compare by the same rule.
* Good, because a changed table's steps are the table form's, with its marks and its holds.
* Bad, because a folder is read by the plugin's own parser: a statement it cannot read is a note and its table
  is held, where applying it to a server would have read it.
* Bad, because a column renamed is one dropped and one added; the script marks the drop, and a rename is
  written in a console.

### Confirmation

`plugins/database/tests/compare-schema-model.test.ts`, `compare-schema-script.test.ts`,
`compare-schema-files.test.ts`, `compare-schema-feature.test.ts`, and against a real PostgreSQL
`compare-schema-live.test.ts`.

## Pros and Cons of the Options

### A model of objects with normalized signatures

* Good, because every side reads into it with no server writes, and the comparison runs in a worker.
* Bad, because the folder's parser covers the DDL PostgreSQL and this plugin write, not every form of it.

### Catalog rows

* Good, because the server reads every form of DDL.
* Bad, because a folder or a snapshot needs a scratch schema written on some server first.

### Dump text, line by line

* Good, because it is simple.
* Bad, because formatting, order and generated names show as differences, and no script follows from it.
