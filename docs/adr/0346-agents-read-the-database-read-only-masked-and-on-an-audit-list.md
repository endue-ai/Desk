---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# Agents read the database read-only and masked, and every call goes on an audit list

## Context and Problem Statement

Agents had three database commands (ADR 0088): the connections, a description and a query whose writes are
always asked. An agent that investigates a database needs more (a plan, a DDL, sample rows, statistics, the
sessions, a check without running), and the person needs to keep some columns and some connections away
from agents and to read afterwards what an agent did. Where is what agents may reach kept, how does the
plugin know who calls, and how are agents' reads kept from writing or carrying sensitive values out?

## Decision Drivers

* Agents never change what they may reach; the connection form and its fields stay the person's
* A read cannot write, cannot run past the settings' limits, and cannot carry a masked value out
* The person reads what agents did apart from their own history, and can export it
* No new bridge method, permission or core change

## Considered Options

* Access per connection in a store key of the plugin's own, the caller from `cmd.invoked`, read-only sessions
  and masking by column name (chosen)
* Fields on the connection (`agentsClosed`, `sensitive`) edited in the connection form
* Masking by each result column's source table (the core's RowDescription table OID)

## Decision Outcome

Chosen option: the first, because it needs nothing of the core and keeps every agent rule in one feature
folder (`plugins/database/ui/features/audit/`).

* **Access.** The store key `agent-access` holds, by connection id, `{ closed, analyze, sensitive }`; only the
  person's commands and the audit panel change it, and the gate refuses those commands to any other caller.
* **Who calls.** The provider hears `cmd.invoked` with `caller`; the SDK hands the handler the same arguments
  object, so the plugin finds the call by it a turn later, else takes the oldest invocation of that command
  not taken yet; a request the desk sends by name has none and is the person's. `desk` is the person, `agent:<id>` and other
  plugins are agents, the plugin's own calls are neither checked nor listed.
* **Reads.** An agent's read runs on a copy of the connection opened read-only (PostgreSQL's
  `default_transaction_read_only`), with the row limit and timeout capped by the settings and a cancel at
  the timeout. A write is asked by the plugin itself, every time, for that run only.
* **Masking.** A result column whose name is a sensitive column's is masked; a read that names a sensitive
  column more often than its results select it under that name is answered with no rows.
* **Audit list.** The store key `agent-audit:<connection>` holds entries newest first (`at`, `caller`,
  `command`, `statement`, `rows`, `asked`, `allowed`, `outcome`, `error`, `database`), 200 and 60 KiB at
  most; it exports as JSON (`endue.database.agent-audit`, version 1).

### Consequences

* Good, because nothing an agent sends can open what the person closed, and the connection's fields and
  form are untouched.
* Good, because a value of a sensitive column reaches an agent neither directly nor under an alias, a
  filter or an expression; the price is that such reads are refused even when harmless.
* Bad, because masking by name masks a column of that name in every table, and a sessions list shows other
  sessions' statements as the server reports them.
* Bad, because the caller is matched to its handler by the plugin, not handed to it: a handler that ran
  without its `cmd.invoked` being heard would count as the person's. The unit and live tests call as an
  agent to hold it; a caller argument on the SDK's handlers would make it exact.

### Confirmation

`plugins/database/tests/audit-*.test.ts` (unit, the panel, and `audit-live.test.ts` on a real PostgreSQL)
and `packages/runtime/e2e/database-audit.spec.ts`.

## Pros and Cons of the Options

### Fields on the connection

* Good, because the form shows them where the connection is set.
* Bad, because every reader of connections (export, import, keychain, the connections file) would carry
  them, and the form is another lane's.

### Masking by source table

* Good, because it masks only the table's column, whatever its alias.
* Bad, because results do not keep the table OID today (a change to every result set), it misses
  expressions (their OID is 0) and other engines have none.
