---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# Parameters go to PostgreSQL as bound values, and a check is Parse and Describe

## Context and Problem Statement

A console's `:name` and `$1` were filled in as quoted literals before the statement was sent (DB-26):
the value became part of the SQL, so a value could change what the statement means if quoting ever
missed a case, the server could not say what type it expected, and a value that did not fit was found
only when the statement ran. The plugin also had two ways to look at a statement without running it:
an agent's `check-statement` sent `PREPARE` and `DEALLOCATE` on a read-only session (PG-91, ADR 0346),
and nothing let a person ask the server what a statement takes and answers. How do parameters reach
PostgreSQL so a value can never change a statement's meaning, and how does the plugin ask the server
about a statement without running it?

## Decision Drivers

* No value is ever part of the SQL text the plugin sends
* The person sees the type the server infers for each parameter before typing it, and a value that
  does not fit is refused before the run
* A check runs nothing, changes nothing, and works on a read-only connection and inside an open
  transaction without failing it
* One check without running in the plugin, for people and agents alike
* An additive change to the bridge's contract (v0)

## Considered Options

* `db.describe` in the core: Parse and Describe of the unnamed statement, then Sync (chosen)
* `PREPARE` of the statement, `pg_prepared_statements` for its types, `DEALLOCATE` after
* Keep literals, quoted more carefully

## Decision Outcome

Chosen option: "`db.describe`", because it is the protocol's own answer to "what does this statement
take and return": ParameterDescription gives each `$n`'s inferred type OID and RowDescription (or NoData)
the columns with names and types, on every server version the core speaks to, with the server's error
and position when it does not parse. No Bind and no Execute go out, so nothing runs on any session, a
read-only one included. Values then travel as `db.run`'s and `db.script`'s `params` (text or null) with
`paramTypes`, which the core's sessions already sent by Bind.

The plugin renumbers a statement's `:name` and `$n` as `$1..$n` in the order of first use, describes it
(on the console's session, under a savepoint when its transaction is open, else on a short read-only
one), names each type in the prompt, refuses a value that does not fit an integer, numeric, float,
boolean, uuid or json type (the server's Bind refuses any other before the statement runs), and sends
the values beside the text. An answer written `=expression` is still put in as SQL, and the run says
which parameters went that way. The executor's `describe` mode is the plugin's one check without
running: Database: check the statement without running it, the parameter prompts, and the agents'
`check-statement` all go through it. MySQL and SQLite, which run through their client programs, keep
filling literals.

### Consequences

* Good, because a value is data: quotes, `;`, comments and an injection-shaped string are stored as
  text, and arrays, json, bytea and timestamps go as the server reads them
* Good, because the person sees types before typing and a wrong value is refused at once
* Good, because the check answers column names and types on every version, which `PREPARE` and the
  catalog view did not (its result types came only in PostgreSQL 16, without names)
* Bad, because a run with parameters costs one more round trip (the describe) before the prompts
* Bad, because a console result with bound values is not offered pages (paging sends the text alone)

### Confirmation

`crates/desk-pg/tests/live_describe.rs` describes against a real server (types, NoData, the error's
position, nothing run, an open transaction kept); `plugins/database/tests/params-live.test.ts` round-trips
values through the core; `bind.test.ts`, `params-bound.test.ts` and `check-statement.test.ts` hold the
plugin's side; `packages/runtime/e2e/database-params.spec.ts` the prompts and the check in the page.

## Pros and Cons of the Options

### `PREPARE` and `pg_prepared_statements`

* Good, because it needs no new bridge method
* Bad, because it names a statement on the session that must be let go of, leaves column names out,
  and has result types only on PostgreSQL 16 and later

### Literals quoted more carefully

* Good, because nothing changes on the wire
* Bad, because the value stays part of the statement, and the server still cannot say its type first
