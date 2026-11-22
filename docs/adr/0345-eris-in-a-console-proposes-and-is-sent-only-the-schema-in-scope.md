---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# Eris in a console proposes, and is sent only the schema in scope

## Context and Problem Statement

The Database plugin's consoles get help from the desk's brain (#493, PG-90): a statement written from a
sentence, a statement or a plan explained, an error fixed. A console holds what must not leave the desk
unasked: the rows of the last result, values in an error's DETAIL, typed parameters, and connections
tagged production. A schema can hold thousands of tables, more than a prompt carries. What is sent, how
does the person see it and keep it from going, and how does an answer reach the console without running?

## Decision Drivers

* Nothing runs on Eris's word: the person reads, may change, and runs
* What is sent is written down, shown before the first time and readable at any time, and tested
* No row or value goes unless the person ticks a sample; never from production unless turned on for it
* A connection can be closed to the brain altogether
* The prompt stays within brain.ask's 32,000 characters on any schema
* The same help with endue AI, a local model or no brain at all

## Considered Options

* `brain.ask` with a tool per task, a proposal dialog, and a cut schema of names, types and comments
* The person's conversation with Eris (`brain.say`), with Eris calling the plugin's commands
* The whole schema, or the schema with sample rows of every table, sent as context

## Decision Outcome

Chosen option: "`brain.ask` with a tool per task", because an ask is one question in a session of its own
(ADR 0059) that never reads or writes the conversation, its answer is a tool call's arguments checked
before use, and the prompt is built here from facts the plugin chose, so it can be shown and tested
exactly.

* Four tools: `propose_sql` and `fix_sql_error` (a statement and an explanation), `explain_sql` (an
  explanation) and `explain_sql_plan` (an explanation and an optional suggestion).
* Sent: the sentence, the statement, an error's SQLSTATE, message, position and HINT, a plan's nodes,
  and the tables the text names plus their neighbours by foreign key, at most 24 tables and 16,000
  characters, by name, kind, comment, columns' names, types and comments and foreign keys' names. Never
  a default, a check's or an index's text, a routine's body or a count. An error's DETAIL, QUERY and
  CONTEXT lines go only with a sample, which is the first five rows of the last result, ticked by the
  person, and refused from a production connection unless samples are turned on for it.
* The prompt is shown before a connection's first ask (Send or Cancel) and on request; the proposal
  dialog keeps it.
* A proposed statement is planned by the server with EXPLAIN (SQLite: EXPLAIN QUERY PLAN) as the plugin's
  own read before it is offered, and marked by the guards' classification. Taken, it goes into the
  console; it runs only when the person runs it, under the same guards as a typed statement.
* The plugin's store keeps under `assist` four lists of connection ids: `shown`, `closed`, `sample`,
  `production`. No prompt or answer is kept.
* The plugin declares `brain:ask`. The runtime routes a `brain.ask` turn to the window that asked, as it
  routes a `brain.say` turn (`packages/runtime/src/owners.ts`), which it did not before.

### Consequences

* Good, because what leaves the desk is one function's output, shown verbatim and pinned by tests
* Good, because a wrong answer costs a dialog: nothing runs, and the server's refusal is shown with it
* Good, because a large schema costs a bounded prompt, and the cut is said in it
* Bad, because a table the text does not name and no key links is not sent, so a vague sentence may get
  a statement over the wrong tables until the person names one
* Bad, because MySQL's and SQLite's schema goes without comments and foreign keys (the catalog's reads
  do not hold them), so their neighbours are not found
* Bad, because DDL and statements with parameters are offered unchecked by the server

## More Information

`plugins/database/ui/features/assist/` (`payload.js` what is sent, `scope.js` the cut, `check.js` the
marks and the server's check, `flow.js` one ask), `plugins/database/docs/assist.md`, ADR 0059 (brain.ask),
ADR 0285 (the schema cache), ADR 0262 (events to whom they are for). Agents' own commands for this
(PG-91) are a separate task.
