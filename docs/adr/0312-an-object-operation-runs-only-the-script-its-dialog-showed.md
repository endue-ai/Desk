---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# An object operation runs only the script its dialog showed

## Context and Problem Statement

PG-52 (#476) lets the person, and agents, change objects from `endue.database`'s explorer: rename,
move to another schema, change the owner, comment, drop, truncate, refresh a materialized view, enable
or disable a trigger, and edit a view's, a materialized view's or a routine's source and apply it.
Each is DDL the plugin writes from a few answers, on a server where a DROP ... CASCADE can take far
more than the object, and on engines whose DDL can say very different things. How is the person
shown what will run, which guards apply, who can call it, and how does a kind the explorer learns
later (PG-50) join?

## Decision Drivers

* The person reads the exact statement before it runs, not a description of it
* What a drop takes along is known before the question, and CASCADE is never implied
* A read-only connection never changes; production says so; an agent never changes without the person
* Every name is quoted by the plugin's own helpers, so a name with quotes, case or spaces stays one name
* A source edit is applied whole or not at all, and an error points at its line
* PostgreSQL first; MySQL and SQLite get what their DDL allows and say what they cannot
* The schema cache and the explorer's kind tables (`schema-cache/kinds.js`, `explorer.js`) stay
  someone else's: new kinds join without editing them

## Considered Options

* A dialog that shows the exact script and is always asked, whoever calls; the run goes through
  `deps.execute`
* The palette's yes or no, with the statement in one line under Yes
* Run an agent's call as asked once the core's approval is given, and ask only the person

## Decision Outcome

Chosen option: "a dialog that shows the exact script and is always asked", because a statement's one
line in the palette cuts what matters (CASCADE, RESTART IDENTITY, a long source), and an agent's
arguments are exactly what the person must read.

* Each operation has one dialog (`features/objects/dialog.js`): the connection with its engine and
  environment tag, the fields (filled from the server or from a command's arguments), the choices,
  what depends on the object, notes on what the statement does beyond its words, and the script. The
  script is written again from the same model on every keystroke and choice; one the answers cannot
  make says why in its place (an unchanged name, a name over 63 bytes, CONCURRENTLY without a unique
  index) and Run waits. Cancel and Escape run nothing.
* The script the dialog showed is the one run, through `deps.execute`, so the plugin's guards apply as
  to any console run: a read-only connection refuses (and is refused before the dialog, so nothing is
  asked for nothing), a production connection is asked again with its tag named, and DROP and TRUNCATE
  are asked as dangerous under the `confirm` setting. A DDL statement run there makes the schema
  cache read what it touched again.
* Agents get every operation as an `endue.database.*` command with an argument schema (ADR 0088). Their
  arguments fill the dialog; the person still reads it and presses Run, so the dialog is the person's
  yes. `.drop-object` and `.truncate-table` are marked irreversible, so the core waits for approval
  first; `.edit-source` and `.generate-sql` only read and write into a console.
* A drop reads what depends on the object from `pg_depend` first, as PostgreSQL's own drop walks it:
  what goes with it through automatic and internal dependencies (its constraints, indexes, triggers,
  sequences, policies: listed as "goes with it") and what a normal dependency reaches beyond that (a
  view, another table's foreign key: listed as what a plain DROP is refused for), 200 at most, with
  the rest counted. CASCADE is a checkbox of its own, never on unless the person (or the command's
  `cascade`) ticks it, and the script shows it.
* A source opens in a console of its own, named after the object. Apply reads that console's text,
  shows the script and runs it in one transaction where the engine rolls DDL back (`psql
  --single-transaction`, SQLite's): `CREATE OR REPLACE` for a view and a routine; a materialized view,
  which has no `CREATE OR REPLACE`, is dropped and created again with the indexes and the comment its
  text holds, its grants not kept (said in the dialog), and refused while anything else depends on it.
  A trigger's source is its function's. An error in the text selects its line in the console.
* What each engine does to each kind is one table (`features/objects/kinds.js`): a row per kind with
  the word its DDL names it by, the catalog its dependents are in, whether it is named on its table or
  by its arguments, and the operations it takes. The statements are written from those fields alone,
  so a kind PG-50 adds to the explorer joins with one row. An operation a row does not list is said as
  such ("Rename is not on SQLite for a view.").

### Consequences

* Good, because what runs is what was read, CASCADE included, from the person or an agent alike
* Good, because the guards are the plugin's one set, not a second set to keep in step
* Good, because a failed source edit leaves the object as it was, on PostgreSQL and SQLite
* Bad, because every operation is two steps even for a rename the person typed a moment ago; a change
  of schema is rare and costly enough to accept it
* Bad, because a production DROP is asked twice (the dialog, then the production question); the second
  names the environment, which the first only tags
* Bad, because MySQL commits DDL at once: its source edit and truncate cannot be rolled back, which
  the dialog says
* Bad, because a materialized view's grants are lost when its source is applied, until PostgreSQL has
  a way to replace one in place

### Confirmation

`plugins/database/tests/objects-sql.test.ts` (each statement, quoting, refusals, the MySQL and SQLite
subset, templates), `objects-feature.test.ts` (menus, the drop with its dependents, the guards, the
cache read again, a source applied with an error's line selected), `objects-dialog.test.ts` (the
script rewritten as the person answers), `objects-live.test.ts` on a real PostgreSQL, and
`packages/runtime/e2e/database-objects.spec.ts`.

## More Information

`plugins/database/ui/features/objects/` (`kinds.js` the table, `facts.js` the reads, `sql-postgres.js`
and `sql-other.js` the statements, `dialog.js`, `source.js`), `plugins/database/plugin.json`. Builds on
ADR 0088 (agents' tools), ADR 0285 (the schema cache) and ADR 0290 (asked every time, whoever asks).
Privileges (PG-54) and reindex and analyze (PG-73, #489) are left to their own tasks.
