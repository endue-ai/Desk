# Client certificates (PG-11)

A PostgreSQL server whose `pg_hba.conf` says `clientcert=verify-full` (or `cert`) lets in only a client
that presents a certificate its authority signed. ADR 0331 has the why.

- The connection form has **Certificate file** and **Key file** (PostgreSQL only), both or neither, each a
  full path (`/` or `~/`). Only the paths are kept, as `sslCert` and `sslKey`. A URI reads and writes them
  as `sslcert` and `sslkey`.
- A session reads both files with `fs.read` (one `fs:read` request covers both) and hands their PEM to
  `db.open`; the core decodes them before anything connects (`engines/pg-tls.js`). A file that is missing,
  cannot be read, or holds no PEM certificate or private key ends the run with its field's name, and
  nothing connects. With a certificate the "client's default" mode is sent as `prefer`; `disable` sends
  neither.
- Keys: PKCS#8, PKCS#1 (RSA) or SEC1 (EC), plain or PKCS#8 encrypted with PBES2 (AES with PBKDF2 or
  scrypt). The older per-file PEM encryption and DES are refused with a sentence: re-encrypt the key as
  PKCS#8.
- An encrypted key: `db.open` answers `keyPassword: needed`, the password prompt asks for the passphrase
  (without the keychain choice) and the session opens again. A passphrase that worked stays in memory for
  the desk's session, by connection and key file; it is forgotten when it is wrong, on Disconnect, Forget
  password and Remove, and never written to the store, the keychain, a log or the history. Agents' runs
  and quiet reads never ask: they end with "Key file: ... is encrypted, and its passphrase was not typed."
- Backups and restores (pg_dump, pg_restore) get `PGSSLCERT` and `PGSSLKEY`. libpq has no variable for a
  key's passphrase, and an argument would show it to other programs, so an encrypted key works on the
  session path only.
- libpq's default files under `~/.postgresql/` are not read on the session path; the fields' placeholders
  name them.
- A connections file carries both paths, never a passphrase, and a `pg_service.conf` import reads
  `sslcert` and `sslkey` ([connections-file.md](connections-file.md)).

Tests: `tests/client-cert.test.ts` (the URI, the form's checks, what reaches `db.open` and the programs,
the passphrase), `tests/client-cert-live.test.ts` (a server that requires certificates, when
`ENDUE_DB_TEST_POSTGRES_CLIENT_CERT` names one).
