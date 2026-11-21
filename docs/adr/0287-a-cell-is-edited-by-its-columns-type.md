---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# A cell is edited by its column's type, and DEFAULT is a pending value of its own

## Context and Problem Statement

`endue.database` edits a cell as text in a field over it, and the change stays pending until Submit runs
every change in one transaction (ADR 0115). A boolean, an enum, a date, JSON, an array or bytes typed as
text is checked only by the server, at Submit, where one wrong value rolls back every change with a
message that names the statement, not the cell. A column could not be set to its default, and a generated
column looked editable until the server refused it. PG-40 (#467) asks for a cell edited by its type. Where
does the type come from, what does an editor produce, and how is DEFAULT told apart from NULL and from the
text `DEFAULT`?

## Decision Drivers

* Pending changes and one transaction stay as they are (ADR 0115); an editor only makes a pending value
* What the type refuses is said in the editor, with the reason, before it is pending
* The type is the server's: an enum's labels, a domain's base type, an array's element
* One resolver that later takes the type OIDs the core's sessions carry (PG-01c, #441)
* Keyboard first; the look is the theme's (ADR 0090)
* Small changes to the grid, which PG-42 (#469) changes at the same time

## Considered Options

* Read each table's types with one catalog query, and resolve an editor per column from them
* Read the types from the declared names the catalog already gives (`format_type`)
* Leave the checks to the server and only make the editors look different

## Decision Outcome

Chosen option: "one catalog query per table", because only pg_type and pg_enum say what a domain or an
enum is. `cell-editors/pg-types.js` follows a domain to its base type (with its NOT NULL and default) and
an array to its element, and reads the base type's internal name and category, an enum's labels, the
generated and identity marks and the session's `TimeZone`. `resolve.js` maps a name and category to one
of twelve kinds; built-in OIDs map to the same pair, so PG-01c feeds it without a query. MySQL and
SQLite, and a PostgreSQL table whose types could not be read, resolve from the declared name. The types
are kept with the catalog's answer for the table's columns, so a refresh of the catalog reads them again.

An editor produces the value as the server writes it (`t`, `{1,2,3}`, `\x00ff`) or the reason it is
refused. Its SQL literal is quoted with an explicit cast to the column's type for enum, JSON, arrays, UUID,
dates and times, intervals and bytes; never for a character or bit type with a length, whose explicit
cast cuts a longer value where an assignment refuses it. Booleans are `TRUE` and `FALSE`, numbers bare.

DEFAULT is one frozen `String` object, told apart by identity: the grid draws it as the word, a literal
writes `DEFAULT`, an INSERT leaves the column out, and SQLite, which has no DEFAULT in an UPDATE, refuses
it in the cell. A refusal on Submit whose position falls in a cell's literal names that row and column.

### Consequences

* Good, because a wrong value is refused where it is typed, with the type's own words (a day that does
  not exist, an integer out of range, JSON's line and column)
* Good, because DEFAULT and generated columns are what the server makes of them, said before Submit
* Good, because the grid and the pending model change by a hook each; the editors are a folder of their own
* Bad, because the checks repeat some of the server's input rules; where they are looser the server still
  refuses at Submit, and where they are stricter a value the server takes is refused (an interval or a
  date in a style other than ISO is written in ISO instead)
* Bad, because one more catalog query runs the first time a table is edited

### Rejected

* Declared names alone: an enum, a domain or an array of either is a name the plugin cannot read
* The server's checks alone: one wrong value rolls back every change, and the message names a statement

## More Information

Issue #467, plan #438; ADR 0115 (pending changes), ADR 0038 (the clients), ADR 0281 (the core's sessions,
whose OIDs PG-01c brings), ADR 0260 (why bytes are saved to Downloads). Bytes loaded from a file are
256 KiB at most: the literal goes to psql as one argument.
