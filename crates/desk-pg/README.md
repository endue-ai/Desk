# desk-pg

PostgreSQL sessions for the core's `db.*` (ADR 0281): protocol 3.0 on `postgres-protocol` (=0.6.12)
over tokio and rustls (ring). Every session's task runs on one runtime thread, `desk-pg`; a
session's calls block the calling thread until the server answers. The crate knows nothing of
plugins, grants or the bridge: `desk-core` owns sessions per caller and maps them onto `db.*`.

Layer: Rust core. Status: PostgreSQL 3.0, text results; the core serves it (`crates/desk-core`).

## Public API

- `open(Config, Sink) -> Opened { session, pid, auth, tls, parameters }`. `Config` holds host, port,
  database, user, the password (used once) or the password file read when the server asks
  (`pgpass::default_file`), `TlsMode` (disable, prefer, require, verify-ca, verify-full; a PEM
  `ca_pem`, else the platform's roots), settings, `read_only` and the sign-in timeout (10 s, 120 s
  at most), and `client_cert` (`ClientCert::from_pem(cert, key, passphrase)`: PEM, an encrypted PKCS#8 key
  decrypted with PBES2, ADR 0331). Sign-in: SCRAM-SHA-256, -PLUS over TLS, md5, or the password over TLS.
- `Session::run(Statement, Limits)`, `fetch(Limits, close)`, `copy(CopyInput)` answer a `Page`:
  columns with type and origin, rows of the server's text (`None` is NULL), `more`, and with the
  last page the tag, the row count over all pages, the transaction state, or the server's error.
  A run closes the result left open; one statement runs at a time (`Error::Invalid` otherwise).
- `Limits::new(rows, bytes)`: 1000 rows (1 to 10,000) and 4 MiB (64 KiB to 16 MiB) a page, always
  one row; one row is read past the page so `more` is exact. A row over `MAX_ROW` (64 MiB) is read
  past as it streams and ends its result with `Error::TooLarge`.
- COPY: `COPY ... TO STDOUT` pages carry `data`; `COPY ... FROM STDIN` takes `COPY_CHUNK` (1 MiB)
  chunks until `done` or `fail`. Closing a COPY out early cancels it on the server.
- `cancel()` sends the backend's key on a connection of its own, in the session's TLS mode; the key
  never leaves the crate. `close(CloseReason)`: the first reason is the one the `Closed` event names.
- `Sink` receives `Event::Notice`, `Notification`, `Parameter` as they come and `Closed` last
  (closed, server with its FATAL error, io, encoding, unloaded, revoked, desk).

## Testing

`cargo test -p desk-pg`: unit tests in the modules. `tests/live.rs` and `tests/live_session.rs` run
against the server `ENDUE_DB_TEST_POSTGRES` names (a `postgresql://` URI without TLS);
`tests/live_tls.rs` against `ENDUE_DB_TEST_POSTGRES_TLS` (verify-full to `localhost` with
`sslrootcert`) and `ENDUE_DB_TEST_POSTGRES_OTHER_CA`; `tests/live_client_cert.rs` against
`ENDUE_DB_TEST_POSTGRES_CLIENT_CERT` (`clientcert=verify-full`, with `sslcert`, `sslkey`, `sslpassword`).
Each skips when its variable is unset.
