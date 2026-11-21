---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# PostgreSQL sessions live in the core, behind db.* and a db:connect grant

## Context and Problem Statement

`endue.database` runs `psql` once per run (ADR 0038): one process, one connection. A transaction cannot
span two runs, session settings end with the run, values arrive as text with their types read from the
catalog, a run's output stops at 64 MiB, `COPY` through the client is refused, and the person has to
install `psql` 13 or newer. ADR 0038 named a session that stays open as the next decision. The
PostgreSQL plan (#438) builds on it: transactions under the person's control, results of any size in
pages, notices and notifications, `COPY` in and out, a cancel that stops the statement on the server.
Who speaks PostgreSQL's protocol over a connection that stays open, and what does a plugin's grant
then cover?

## Decision Drivers

* TLS with `verify-full` and SCRAM sign-in, as the person's servers require
* Results as the server wrote them (the plugin's NF-10), with each column's type and table of origin
* A cancel that stops the statement on the server and leaves the session usable
* Results and `COPY` of any size with flat memory; notifications while idle; notices as they come
* A grant that says what it gives (ADR 0012): signing in to a database is not a raw socket
* Passwords never written down, never read back by the plugin
* Nothing for the person to install

## Considered Options

* A driver in the core behind a new `db.*` bridge namespace and a `db:connect` permission
* The plugin speaks the protocol itself over the bridge's sockets (`net.*`, ADR 0133)
* One `psql` per session, statements on its standard input after `\restrict` (psql 17.6 and later)

Inside the first, two ways to build the driver: `tokio-postgres` 0.7.18 as it is, or a session of
the desk's own on `postgres-protocol` 0.6.12, the same project's message and SCRAM crate (MIT OR
Apache-2.0) that `tokio-postgres` runs on.

## Decision Outcome

Chosen option: "a driver in the core behind `db.*` and `db:connect`", for PostgreSQL only, because it
is the only way that does everything on the list; the plugin's other engines stay on ADR 0038. The
driver is a session of our own on `postgres-protocol`, not `tokio-postgres`: that driver binds every
result as binary (its `query.rs` sends result format 1), so a value reaches the client as bytes to
decode per type, never the server's text, and its simple query gives text but columns with a name
and nothing else. The spike's session, TLS and paging code is about 750 lines.

### Measured

`spikes/pg-session` (`./run.sh`), 2026-11-21, PostgreSQL 17.12, an Apple M4 Max under other work
(load average 10; a run at 50 to 140 gave the same memory and two to four times the times).

| Check | Core driver (spike) | `net.*` in the plugin | `psql` on standard input |
| --- | --- | --- | --- |
| SCRAM | SCRAM-SHA-256, 2.8 ms median of 20 sign-ins; SCRAM-SHA-256-PLUS over TLS, 4.5 ms with the handshake | plain text only | psql's own |
| TLS `verify-full` | TLS 1.3; refused for a name the certificate lacks and for another authority; `verify-ca` and `require` sign in | none: the TLS server answers SSLRequest `S`, then needs a ClientHello the frame cannot make; a startup message there gets 0 bytes and a closed socket | psql's own |
| Column types and origin | type OID and modifier, table OID and attribute number per column (a view's column names the view); expressions 0 | the frame would parse them | lost: CSV names only |
| Cancel of `pg_sleep(30)` | 57014 1.8 ms after the request (5 to 14 ms over TLS), pg_stat_activity `active` then `idle`, the session goes on; in a transaction it is failed until ROLLBACK | a second socket | SIGINT: psql sends the cancel and exits (status 3), the session is gone; `pg_cancel_backend` from a second connection keeps it |
| 1,000,000 rows | pages of 1,000: 1.17 s, memory +0.9 MiB; of 10,000: 0.91 s, +4.6 MiB (peak 7.7 MiB); read whole: +204.6 MiB | 93.1 MiB on the wire is 1,491 `net.data` events, 124.2 MiB of base64 in JSON | `FETCH_COUNT=1000`: psql stays at 20.7 MiB, 0.83 s, CSV text |
| `COPY` of 100 MB | out 101 MiB in 0.31 s (+2.5 MiB), in 0.46 s (+1.3 MiB), rows and hash equal | every byte as base64 | inline `COPY FROM STDIN` works; out mixes into standard output |
| `NOTIFY` while idle | received under 1 ms after the other session's commit | possible | printed only with the next statement (nothing in 2 s) |
| Notices | as they come: at 3 ms and 1,006 ms of a 1,006 ms statement | possible | standard error, apart from the rows |
| Values (NF-10) | the server's text: NULL, `''`, `'NULL'` apart, int8 past 2^53, ISO dates, bytea hex; the same over both protocols | possible | CSV with a random NULL text |
| Errors | all 18 field codes (S V C M D H P p q W s t c d n F L R) | possible | text lines in VERBOSITY verbose to parse back |
| To install | nothing | nothing | psql 17.6 or later |

`tokio-postgres` (`driver`): numeric `12.50` arrives as 12 bytes, a timestamptz as 8, an interval as
16; read as a string it is an error. Two statements in one extended-protocol run are the server's
42601 (`cannot insert multiple commands into a prepared statement`).

### What PG-01b (#440) builds

**Where.** A crate `crates/desk-pg`: the session on `postgres-protocol` (pinned), tokio (`rt`, `net`,
`io-util`, `time`, `sync`) on one runtime thread for every session, tokio-rustls with rustls 0.23 and
ring and `rustls-platform-verifier`, as desk-sys. `crates/desk-core/src/core_db.rs` serves `db.*` and
checks `db:connect` as `core_sockets.rs` checks `net:connect`. Specs: `specs/bridge/v0/db.schema.json`,
`DbConnectPermission` in `specs/plugin/v0/permission.schema.json`, both READMEs, vectors and codegen;
the runtime routes `db:<sessionId>` like a socket (`owners.ts`: `db.open` claims, `db.closed` ends).

**Methods** (`engine` is `postgresql`; any other is `unsupported`):

* `db.open { engine, host, port?, database, user, password?, tls?, settings?, readOnly?, timeoutMs?, scope }`
  → `{ sessionId, pid, auth, tls?, parameters }`. `host` is a name or an IPv4 address as
  `net.connect` takes it, `port` 5432 by default, `timeoutMs` 10 s (120 s at most) for the connection
  and the sign-in. `tls` is `{ mode, ca? }`: `disable`, `prefer` (the default, as libpq), `require`
  (encrypted, the certificate not checked), `verify-ca` (the chain), `verify-full` (the chain and the
  host name); `ca` is the authorities' PEM, else the OS's trust store. SCRAM-SHA-256-PLUS whenever
  TLS is on and the server offers it. `settings` are startup parameters (`DateStyle`, `TimeZone`,
  `search_path`, `statement_timeout`, `application_name`, ...); `client_encoding` is always `UTF8`, so
  naming it, `user`, `database` or `replication` is `invalid_params`. `readOnly` adds
  `default_transaction_read_only=on`. `auth` is `scram-sha-256-plus`, `scram-sha-256`, `md5`,
  `password` or `none`; `tls` is `{ version, cipher }` when on; `parameters` every ParameterStatus
  (`server_version`, `TimeZone`, `IntervalStyle`, ...). A server that refuses answers `{ error }`
  (below) and no session; a refused or unreachable host, or a certificate that fails its mode, is
  `io_error` with why; a 17th session is `invalid_value`.
* `db.run { sessionId, sql, params?, paramTypes?, pageRows?, pageBytes? }` → a page. One statement by
  the extended protocol: Parse, Bind with text result format, Describe, Execute; a script is split by
  the plugin, and two statements are the server's 42601. `params` are text or null, their types the
  server's inference unless `paramTypes` gives OIDs (0 infers). While an earlier result still has
  pages, `db.run` closes it first; while a statement runs, `db.run` is `invalid_params`.
* `db.fetch { sessionId, pageRows?, pageBytes?, close? }` → the next page; `close: true` ends the result
  without reading on (Sync).
* `db.copy { sessionId, data?, encoding?, done?, fail? }` sends `COPY ... FROM STDIN` data (`utf8` or
  `base64`, 1 MiB a call); `done` ends it, `fail` fails it with that message, and either answers the
  statement's last page. `COPY ... TO STDOUT` answers pages whose `data` holds the bytes, read on with
  `db.fetch`.
* `db.cancel { sessionId }` sends a cancel request with the backend's key on a connection of its own,
  TLS as the session's mode, and only while a statement runs (as with libpq, one that lands as the
  statement ends may still reach the next). The statement's own answer then carries 57014. The key
  never crosses the bridge.
* `db.close { sessionId }` ends the session (Terminate); an ended one is not an error.
* `db.list {}` → the caller's sessions: `sessionId`, `host`, `port`, `database`, `user`, `pid`,
  `running`, `more` (a result has pages left), `transaction`.

A page is `{ columns?, rows, more, tag?, rowCount?, transaction?, error?, copy?, data? }`. `columns`
comes with a statement's first page: `name`, `typeOid`, `typeModifier`, `typeSize`, `tableOid` and
`columnNumber` (0 and 0 for an expression), as RowDescription says; the plugin names types from the
built-in OIDs and its catalog, and the core runs no query of its own on the person's session. `rows`
are arrays of the server's text or `null`. `more` is exact: the core asks for one row past the page and
keeps it. The last page has the command `tag`, `rowCount` (rows over all pages, or the tag's count)
and `transaction` from ReadyForQuery (`idle`, `open`, `failed`). A page holds `pageRows` rows (1,000;
1 to 10,000) or `pageBytes` of values (4 MiB; 64 KiB to 16 MiB), whichever comes first, and always one
row; a row over 64 MiB ends the result with `invalid_value`. `copy` is `{ direction, format, columns }`.

**Events**, to the session's caller only: `db.notice { sessionId, notice }` as each arrives, also
while a statement runs; `db.notification { sessionId, pid, channel, payload }`, also while idle;
`db.parameter { sessionId, name, value }` for each ParameterStatus; `db.closed { sessionId, reason,
message?, error? }`, the session's last event, `reason` one of `closed`, `server` (with its FATAL
`error` when it sent one), `io`, `encoding`, `unloaded`, `revoked`, `desk`.

**Errors.** A statement's error, a refused sign-in and a notice are results, never bridge errors,
which carry no fields: `{ severity, localSeverity, code, message, detail?, hint?, position?,
internalPosition?, internalQuery?, where?, schema?, table?, column?, dataType?, constraint?, file?,
line?, routine?, other? }` for V, S, C, M, D, H, P, p, q, W, s, t, c, d, n, F, L, R, the positions
as numbers, `other` any field code a later server adds. After an error the session is ready again.

**Values.** The server's text form, as JSON strings; binary never. `client_encoding` stays `UTF8`: a
server that reports another ends the session (`encoding`), since its values would no longer be UTF-8.

**Permission.** `db:connect` with `hosts`, as `net:connect`: a host with a port covers that port only,
one without every port. It covers `db.open` (checked against the host and port) and the other methods
and the events on the caller's own sessions; another caller's session is `not_found`. `net:connect`
does not cover `db.*`, nor `db:connect` a socket. The plugin declares `db:connect` for `*` and asks
`perm.request` for a connection's `host:port` before its first `db.open` (ADR 0260), as the screens
plugin asks for `net:connect`. An agent caller is `permission_denied`: agents reach databases through
the plugin's commands, whose read-only, production and agent guards hold.

**Lifetime.** A session belongs to the plugin that opened it. It ends at `db.close`, when the server
or the network ends it, when the plugin stops (turned off, removed, the desk quits) and when its grant
goes; never on a timer of the core's (the server's `idle_session_timeout` applies; TCP keepalive is
on). A window whose frame sleeps (ADR 0134) keeps its sessions and finds them again with `db.list`;
what was notified meanwhile is lost. A caller holds 16 sessions at most.

**Passwords.** Handed in once, at `db.open`, used for the sign-in (SCRAM's proof, md5, or the
password itself only over TLS: a server that asks for it in clear without TLS is `io_error`) and
dropped; never logged, kept or sent back. Without one the core
reads the person's password file as libpq does (`PGPASSFILE`, `~/.pgpass`), so it keeps working
without the plugin reading it. `passwordRef`, a keychain entry the core reads itself, comes with #443.

**The `psql` path** stays only until #441 (PG-01c) lands: then the plugin runs PostgreSQL on `db.*`,
`psql` leaves its `proc:spawn` commands, and nothing stays behind as a fallback. MySQL, MariaDB and
SQLite stay on ADR 0038; a core driver for them would be a decision of its own.

### Consequences

* Good, because sessions keep transactions and settings, read any size in pages with flat memory,
  cancel on the server and hear notices and notifications, with nothing to install
* Good, because values and errors come as the server wrote them, with every column's type and origin
* Good, because a `db:connect` grant names the servers a plugin signs in to, not open sockets
* Bad, because the core carries a protocol client, tokio and a crate pinned by hand: TLS and
  sign-in bugs are ours, and GSSAPI, client certificates (#448), direct TLS and protocol 3.2's longer
  cancel keys are each work of their own
* Bad, because an open result holds its statement on the server: the spike's waiting session showed
  `active` with a snapshot held, so the plugin must close results the person leaves
* Bad, because a `db:connect` grant also lets the plugin sign in with the person's password file for
  those hosts, without seeing it

### Rejected

* `net.*` in the plugin: PostgreSQL's TLS begins on the open socket after the SSLRequest byte, and the
  bridge only moves bytes (`net.connect`, `net.send`, `net.close`, `net.data`, `net.closed`); a frame
  has no TLS for a socket of its own, so the session is plain text or nothing, and every byte crosses
  as base64 in JSON.
* `psql` on standard input: results lose their types and tables, a notification waits for the next
  statement, a cancel by signal ends the session, errors and notices are text on standard error, and
  the person must install psql 17.6 or later.
* `tokio-postgres` as the driver: binary values (see above).

## More Information

Issue #439, plan #438; `spikes/pg-session/README.md` (the checks and how to run them); ADR 0038 (the
clients), ADR 0133 (`net.*`), ADR 0012 (deny by default), ADR 0260 (the manifest bounds grants),
ADR 0134 (frames that sleep), `docs/ko/database-plugin-requirements.md` (NF-01, NF-10). PG-01b (#440)
updates `docs/architecture.md` and `docs/ko/desk-structure.md` with the namespace.
