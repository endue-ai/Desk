# PostgreSQL session spike (#439)

Throwaway code for ADR 0281: three ways `endue.database` could hold a PostgreSQL session open. Its own
Cargo workspace, so the repository's gates never build it. `src/session.rs`, `src/query.rs` and
`src/tls.rs` speak protocol 3.0 with `postgres-protocol`'s messages and SCRAM over tokio and rustls
(ring), the shape the core's driver takes; each check in `src/bin/` measures one thing the ADR quotes.

## Run

```bash
./run.sh              # every check; or ./run.sh cancel stream ... for some of them
```

It needs docker, openssl and cargo (and psql 17.6 or later on PATH for `psql`). It makes a throwaway
certificate authority and a server certificate for `localhost` with openssl, starts PostgreSQL 17 with
TLS in a container on a free loopback port, runs the checks and removes the container. With
`SPIKE_PG_URI=postgresql://user:password@host:port/db?sslmode=disable` the plain checks use that
database instead; they create and drop tables named `spike_*`.

| Check | What it shows |
| --- | --- |
| `signin` | SCRAM-SHA-256 over TCP, SCRAM-SHA-256-PLUS over TLS, the parameters the server reports, a wrong password's fields |
| `tls` | `verify-full`, its refusals (another name, another authority), `verify-ca`, `require`, a cancel over TLS |
| `columns` | Each column's type OID and modifier, table OID and attribute number, checked against pg_attribute |
| `text` | Values in the server's text form (NF-10), the same over both protocols, ParameterStatus after SET |
| `errors` | All 18 error field codes, a notice's fields, the session ready after each error |
| `cancel` | pg_stat_activity before and after a cancel of `pg_sleep(30)`, and inside a transaction |
| `notify` | A notification received while idle; notices received while their statement runs |
| `stream` | 1,000,000 rows in pages with resident memory, against reading them whole |
| `copy` | A 100 MB table out with COPY TO STDOUT and back with COPY FROM STDIN |
| `netpath` | What a plugin over `net.*` gets: the SSLRequest byte, no TLS, the bridge's cost |
| `driver` | tokio-postgres: binary values from its extended query, names only from its simple query |
| `psql` | psql over standard input after `\restrict`: what it stops, keeps and loses |

The numbers measured on 2026-11-21 are in ADR 0281. The spike goes when PG-01b (#440) lands.
