# What agents get of the Database plugin

The agents' read tools, what each connection lets agents reach, and the list of everything they ran (PG-91,
ADR 0346). The first three tools and the rest of the plugin are in [`features.md`](features.md); a change to
agents' access adds its line here.

## Tools

Each is an agent command with an argument schema, marked read-only, and runs as an agent's read (below):

- `endue.database.explain-statement`: the plan of one statement. `analyze` runs it (EXPLAIN ANALYZE), only a
  read, and only where the person allows it on that connection; SQLite has none.
- `.object-ddl`: an object's DDL by schema and name (and kind, when names clash), read from the server.
- `.sample-rows`: a table's first rows, 20 by default.
- `.table-stats` (PostgreSQL): estimated rows, sizes, scans, live and dead rows, the last vacuum and analyze,
  and each column's `pg_stats`.
- `.sessions-list` (PostgreSQL): the server's sessions from `pg_stat_activity`, statements cut at 500
  characters and shown as the server reports them.
- `.check-statement` (PostgreSQL): one SELECT, INSERT, UPDATE, DELETE, MERGE or VALUES described by the
  server on a read-only session (Parse and Describe, nothing runs; `params.md`), which checks its names and
  types and answers its parameters' and columns' types; the error answers with its position in the
  agent's statement. Any other statement answers that it was not checked.

## How an agent's SQL runs

- A read runs on a connection opened read-only: on PostgreSQL a short session with
  `default_transaction_read_only`, SQLite with `-readonly`, MySQL with a read-only session transaction. A
  statement that writes after all (a volatile function, `nextval`) is refused by the server.
- Rows: the agent's `maxRows` or `limit`, at most 1000 and the `max-rows` setting. Time: the agent's
  `timeoutSeconds`, at most the `timeout-seconds` setting, and the run is cancelled when it passes.
- A write (`.query` only) is always asked, whoever calls: the statement, the connection and its tag, that it
  is allowed for this run only, and who asked. Nothing is remembered: the next write asks again. A read-only
  connection refuses it before anyone is asked.

## What agents may reach

The person sets it per connection in Database: agent audit (or Database: what agents may reach of a
connection); agents can neither call those commands nor change it.

- **Closed to agents.** Every command an agent calls naming the connection is refused before it starts, a
  call naming none is refused while any connection is closed, and `.connections` leaves it out.
- **EXPLAIN ANALYZE**, off by default.
- **Sensitive columns** (`column`, `table.column`, `schema.table.column`), masked in everything an agent reads:
  a query's results mask every column of that name (a result does not say its table), sample rows and
  statistics mask the entries that name the table. A read that uses a sensitive column other than by
  selecting it under its own name (a filter, an expression, an alias, ORDER BY) is answered with no rows.
  The person's own reads are never masked.

Who calls comes from the core's `cmd.invoked` (`agent:<id>`, another plugin by its id, `desk` for the
person); a request the desk sends by name is the person's.

## The audit list

- One per connection, newest first, apart from the person's history: when, who, the command, the statement,
  the rows, whether the person was asked and allowed it, and how it ended (ran, failed, refused, not run,
  cancelled) with why.
- Every call of the tools above and of `.connections`, `.schema` and `.query` is on it, whoever makes it but
  the plugin itself, and every other command's call by an agent; a call naming no connection is not.
- 200 entries and 60 KiB a connection, statements cut at 2,000 characters; one that looks like it carries a
  password keeps its first word only.
- The panel draws again when an entry comes. Export writes it as JSON into ~/Downloads
  (`endue.database.agent-audit`, version 1); Clear asks first.

Modules: `features/audit/`.
