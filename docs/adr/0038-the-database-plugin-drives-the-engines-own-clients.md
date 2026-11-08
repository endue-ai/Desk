---
status: accepted
date: 2026-10-31
decision-makers: Team endue
---

# The database plugin drives each engine's own command-line client

## Context and Problem Statement

`endue.database` is a client for PostgreSQL, MySQL / MariaDB and SQLite: connections, an explorer,
SQL consoles, results. Something has to speak each engine's wire protocol. UI plugins run in a
sandboxed frame and reach the machine only through the bridge (ADR 0012), whose `proc.spawn` the core
serves since #119; there is no database namespace in `specs/bridge`. Where does the protocol live, and
how does a plugin built in the community format stay inside its grant when the program it runs can
itself run programs (`psql`'s `\!`, the mysql client's `system`, sqlite3's `.shell` and
`load_extension()`)?

## Decision Drivers

* A plugin in the community format on the public API only, with no spec or core change
* The grant must mean what it says: `proc:spawn` for four clients is not a shell
* Results must be exact: NULL apart from `''` and `'NULL'`, numbers as the server wrote them
* Cancelling must stop the query on the server, not only the client
* Passwords never written down by the plugin

## Considered Options

* Run `psql`, `mysql` / `mariadb` and `sqlite3` through `proc.spawn`, each in a mode that cannot reach
  past the database
* Drivers in desk-core behind a new `db.*` bridge namespace and a `db:connect` permission
* SQLite only, through a WebAssembly build of SQLite reading files with `fs.read`

## Decision Outcome

Chosen option: "run the engines' own clients", because it needs nothing new from the core, keeps the
protocols, TLS and authentication in the programs that own them, and the clients have modes that
close every way out.

* A run is one process and one connection. psql gets each statement as its own `-c`, which it sends to
  the server as written: no meta-command and no variable is read from it, and a statement that starts
  with a backslash is refused before. `-X -w --csv`, `ON_ERROR_STOP`, connection values in `PG*`
  environment variables. mysql gets one `-e` script under a random DELIMITER with `--binary-mode`
  (its commands off), `--local-infile=0`, `--skip-reconnect` and `--xml --binary-as-hex`. sqlite3 runs
  with `-safe -bail` (and `-readonly`), `.mode quote`, a statement per argument; one starting with `.`
  is refused.
* After each statement a marker with a random nonce splits the output by statement and carries the row
  count: `\echo`/`\warn` lines (psql), a `SELECT ROW_COUNT(), @@warning_count` named by the marker
  (mysql), a `SELECT total_changes()` named by it (sqlite3). psql's NULL text is random too.
* Stopping sends SIGINT, which makes psql send a cancel request, the mysql client KILL QUERY and
  sqlite3 interrupt, then SIGKILL a second later. A single read is stopped the same way once it has one
  row more than the limit.
* Passwords reach the client only in `PGPASSWORD` or `MYSQL_PWD`, from memory; the clients' own
  credential files work unchanged. Read-only connections are refused before the client starts and
  opened read-only on the server as well.

### Consequences

* Good, because the plugin is a folder like any community plugin, and `desk plugin validate` and the
  grant prompt describe all it can do.
* Good, because TLS modes, SCRAM and caching_sha2 authentication, `.pgpass` and `~/.my.cnf` come with
  the clients the person already trusts.
* Good, because the live tests run the real clients (psql 15 against PostgreSQL 17, MariaDB 10.11 against MySQL 8.4
  and MariaDB 11, sqlite3 3.40 and 3.50), so a format change shows up as a failing test.
* Bad, because the clients must be installed (`Database: check the clients` says how) and new enough:
  psql 13, mysql 8.0.19 or mariadb 10.5, sqlite3 3.37.
* Bad, because a run is one connection: a transaction cannot span two runs, and session settings end
  with the run. A session that stays open needs a core driver or psql's `\restrict` (17.6 and later)
  over standard input; that is the next decision, not this one.
* Bad, because values arrive as text: types come from the catalog, not from the result. SQLite and
  MySQL name no columns for a result without rows.

## More Information

`plugins/database/README.md`, `docs/ko/database-plugin-requirements.md` (NF-01, the assumptions),
ADR 0012 (plugins run from their folder), `plugins/database/tests/live.test.ts`.
