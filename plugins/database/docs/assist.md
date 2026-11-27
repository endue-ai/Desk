# Eris in a console

Eris helps with the SQL in a console: she writes a statement from a sentence, explains a statement, fixes an
error and explains a plan. Every answer is a proposal: nothing she writes runs until the person runs it. The
rest of the plugin is in [`features.md`](features.md); a change to this help adds its line here. ADR 0345.

## Commands and keys

| Command | Key in the editor | What it proposes |
| --- | --- | --- |
| Database: Eris writes a statement from a sentence | Mod+I | A statement at the caret, or over the selection (which is sent as the statement to change) |
| Database: Eris explains this statement | Mod+E | The explanation as `--` comments above the statement at the caret |
| Database: Eris fixes this error | Mod+J | The statement that failed in the console's last run, fixed, in its place |
| Database: Eris explains this plan | Mod+Shift+H | The explanation of the console's last plan above its statement, and an index or a rewrite after it when one helps |
| Database: what this console sends to Eris | | Shows what is sent, with the sample ticks |
| Database: close this connection to Eris, open it again | | Nothing is sent from a closed connection |

`endue.database.assist-write` also takes `{ sentence }`.

## A proposal

- The proposal dialog shows what Eris says, the text that would go into the console in a field the person
  may change, and its marks: a write, a schema change, what is dangerous (an UPDATE or DELETE without WHERE,
  DROP, TRUNCATE), what a read-only connection refuses and what a production connection asks before. The
  marks are the guards' own classification, drawn again as the text changes.
- Before it is offered, a proposed statement is planned by the server with `EXPLAIN` (SQLite: `EXPLAIN QUERY
  PLAN`), the plugin's own read, which never runs it. The dialog says it plans, or the server's own message
  when it refuses, or why it was not checked: a statement EXPLAIN does not take (DDL, a transaction), or one
  with parameters, and everything after it.
- "Put in the console" puts the field's text there and selects it; "Put aside" and Escape leave the console as
  it was. A taken proposal runs only when the person runs it, under every guard a typed statement passes.
- If the console changed while Eris answered, nothing is put in it: ask again.

## What is sent

Each ask goes through the desk's brain with `brain.ask` (ADR 0059), in a session of its own that never reads
or writes the person's conversation with Eris. The prompt, exactly as it goes, is shown before a connection's
first ask (nothing goes without Send) and with "what this console sends to Eris" at any time; the proposal
dialog keeps it under "What was sent".

- Sent: the sentence; the statement; an error's SQLSTATE, message, position and HINT; a plan's nodes, their
  conditions, estimates, timings and marks; and the schema in scope.
- The schema in scope is the tables the statement and the sentence name (a word matches a table by its name,
  singular or plural), then their neighbours by foreign key both ways, at most 24 tables and 16,000 characters,
  whole tables only; when nothing is named, the first tables by name. Each goes by its qualified name, kind
  and comment, its columns' names, types and comments, and its foreign keys by names. The prompt says how many
  tables were left out. PostgreSQL's schema comes from the schema cache; MySQL's and SQLite's from the
  catalog's reads of the connection's own schema, without comments or foreign keys.
- Never sent: rows and values, a column's default, a check's or an index's text, a routine's body, a count, a
  typed parameter's value. An error's DETAIL, QUERY and CONTEXT lines quote rows, so they go only with a sample.
- A sample is a tick: the first five rows of the console's last result, each value cut to 200 characters,
  2,000 characters in all; no statement is run to make one. From a connection tagged production a sample never
  goes unless "turn samples on for this production connection" is ticked for it.
- Statements are cut to 8,000 characters, a sentence to 2,000 and a plan to 8,000; the prompt stays under
  brain.ask's 32,000.

## Choices kept

The plugin's store keeps, under `assist`, the ids of the connections that saw what is sent, those closed to
Eris, those whose sample is ticked and the production ones with samples on. No prompt and no answer is kept.

## Without a brain

A desk without a brain (`unsupported`), a refused grant, an answer in words only, an offline brain or one that
does not answer in two minutes each say so on the status line; nothing changes and the console works as
before.

Modules: `features/assist/`, the editor's keys in `keys.js`. Tests: `tests/assist-*.ts`,
`packages/runtime/e2e/database-assist.spec.ts`.
