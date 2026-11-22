---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# A table form runs the script written from its design

## Context and Problem Statement

PG-51 (#475) lets the person create a PostgreSQL table, and change an existing one, by editing its
design in `endue.database`: columns, keys, checks, foreign keys, indexes, partitioning, comment and
owner. ALTER TABLE is where a client can do the most damage quietly: a rename written as a drop and an
add loses a column's data, a type change rewrites the whole table under a lock or fails halfway, and a
form that guesses a USING expression or a column order runs something the person never read. ADR 0312
decided that an object operation runs only the script its dialog showed. How does a form that edits a
whole table keep to that, and what does it do with a change it cannot write safely?

## Decision Drivers

* The person reads the exact statements, in the order they run, before anything runs
* A rename is a rename, never a drop and an add
* The dangerous steps are named where they are: a rewrite, a lock, a dropped column, a change that can fail
* A change the form cannot write safely is said, not guessed
* The guards of ADR 0312 apply as they are: read-only, production, dangerous statements, agents
* Every identifier is quoted by the plugin; an expression is written as the person typed it

## Considered Options

* The design as a model, diffed by the server's identities into one ordered script shown as it grows
* A dialog per change (add a column, rename one), each run alone as the objects feature does
* Compare names: what is missing was dropped, what is new was added

## Decision Outcome

Chosen option: "the design as a model, diffed by the server's identities", because only a whole
script shows how the changes interact (a column dropped with the index on it, renames that take each
other's names), and only identities tell a rename from a drop and an add.

* The form holds the design read from the server, each part under an id the server gave it (a column's
  attnum, a constraint's or index's oid); new parts get ids of their own. The script is written from
  the difference of the two on every edit (`features/table-design/script.js`) and is what Run, Dry
  run and Open in console use: there is no second writer.
* Order: the table renamed; indexes and constraints that go or change dropped; columns dropped; columns
  renamed in an order that applies (a cycle is refused); constraints and indexes renamed; each column's
  changes, with every type change in one ALTER TABLE so the table is rewritten once; new columns; new
  constraints and indexes; comments; the owner. A changed index or constraint is dropped and created
  again; one the form cannot draw (an opclass, INCLUDE, NOT VALID, deferrable, an exclusion constraint)
  is kept: renamed or removed, never edited.
* Marks are `-- ` lines in the script itself, above their statement, so a console gets them too: a
  rewrite of the whole table, NOT NULL and new constraints that read every row under a lock, an index
  built while writes wait, a dropped column, a type change that can fail, a NOT NULL column added with
  no default, a volatile default, an identity's sequence starting at 1, a partitioned table's partitions.
* Held, in words, with Run waiting: a type change with no implicit or assignment cast (it needs USING:
  the script opens in a console to finish), a column made generated, a generation changed before
  PostgreSQL 17, a part that holds a dropped column (the server would drop it silently), a field's
  problem. An existing table's columns keep their order; the form says so instead of rebuilding it.
* The steps run in one transaction (`deps.execute`, mode `transaction`), so the plugin's guards apply as
  to any run and the schema cache reads what changed; a failing step rolls all of it back. CONCURRENTLY,
  offered only for a new index on an existing table, cannot run in a transaction: it runs after COMMIT,
  each index on its own, the script says so, and a dry run leaves it out.
* Agents get `.create-table` and `.change-table`, which only open and fill the form and answer its
  script; the run commands are not agent tools, so the person runs what the agent proposed.

### Consequences

* Good, because what runs is what was read, a rename keeps its data, and a failure leaves the table as it was
* Good, because a change the form will not write is said in a sentence with the way to finish it
* Bad, because a type change that needs USING, a column order or a kept part's edit go through a console
* Bad, because CONCURRENTLY indexes leave the one transaction: one that fails leaves an invalid index to drop

## More Information

Issue #475 (PG-51); ADR 0312 (object operations); ADR 0285 (the schema cache);
`plugins/database/docs/table-design.md`.
