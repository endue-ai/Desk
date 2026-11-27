---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# A PostgreSQL session presents a client certificate, decoded in the core

## Context and Problem Statement

A server whose `pg_hba.conf` says `clientcert=verify-full` (or `cert`) lets in only a client that
presents a certificate its authority signed. ADR 0281's sessions take a TLS mode and the authorities
to trust, nothing to present. libpq names the files `sslcert` and `sslkey` and decrypts an encrypted
key with `sslpassword`. How does the certificate reach a session, where is the key decoded, and what
happens to an encrypted key's passphrase?

## Decision Drivers

* The plugin keeps paths only; a key's passphrase is asked per session and never kept (#448)
* A file that cannot be read is said with its field's name before anything connects
* No new permission: the plugin already reads its CA file with `fs.read` under `fs:read`
* The key and its passphrase never reach the store, the keychain, a log or the history
* The keys people have: PEM, plain (PKCS#8, PKCS#1, SEC1) or encrypted PKCS#8; no new TLS stack

## Considered Options

* The plugin reads both files with `fs.read` and hands their PEM to `db.open`; the core decodes them
  and decrypts an encrypted key with the RustCrypto `pkcs8` crate (PBES2)
* `db.open` takes the paths and the core reads the files itself, checking `fs:read` on its own
* As the first, but without encrypted keys: a person decrypts the key first
* Decrypt the key in the plugin's frame (WebCrypto has PBKDF2 and AES-CBC) and hand over a plain key

## Decision Outcome

Chosen option: "the plugin reads both files and hands their PEM to `db.open`; the core decodes them",
because it is how the CA file already goes (one grant model, one prompt for both files), and the
plugin can name the field of a file that cannot be read before it calls `db.open`. A path in
`db.open` would make the core check a second permission inside a database call and the plugin ask
for a grant a `db.open` refusal cannot name. Refusing encrypted keys breaks the Requirement's
passphrase, and pushes people to leave a key unencrypted on disk. Decrypting in the frame needs an
ASN.1 reader in JavaScript and leaves the plain key in a page's memory.

**Wire.** `db.open`'s `tls` takes `cert` (PEM, the chain), `key` (PEM) and `keyPassword` (an
encrypted key's passphrase); `cert` and `key` come together. The core decodes them before anything
connects: the key first, so `DbOpenResult.keyPassword` answers `needed` (an encrypted key and no
passphrase) or `wrong` (it does not decrypt), then the chain, and the key must be the certificate's
(`invalid_value` otherwise). The passphrase is used once and dropped; the decoded key is held for the
session and its cancel requests. `disable` ignores both: it has no TLS to present them on.

**Encryption.** PKCS#8 with PBES2: AES-128/256-CBC (and GCM) with PBKDF2 (HMAC-SHA-256, or the
HMAC-SHA-1 older tools write, decrypt only) or scrypt, through `pkcs8` 0.11 (`encryption`, `pem`,
`sha1-insecure`; Apache-2.0 OR MIT, RustCrypto). No DES and no PBES1; the older per-file PEM
encryption (`Proc-Type: 4,ENCRYPTED`) is refused with a sentence saying to re-encrypt as PKCS#8.

**The plugin.** A PostgreSQL connection has "Certificate file" and "Key file" (`sslCert`, `sslKey`,
URI `sslcert`, `sslkey`), both or neither, full paths. `engines/pg-tls.js` reads them with `fs.read`
under one `fs:read` request for both; a missing or unreadable one, or one that holds no PEM
certificate or key, ends the run with that field's name and no `db.open`. With a certificate the
`default` mode is sent as `prefer`. On `keyPassword` the password prompt asks for the passphrase
(without the keychain choice), and the session opens again once; a passphrase that worked is held in
memory by connection and key path for the desk's session, like a typed password, and forgotten when
it is wrong, on Disconnect, Forget password and Remove. Runs that may not ask (agents, quiet reads)
end with a sentence instead. pg_dump and pg_restore get `PGSSLCERT` and `PGSSLKEY`; libpq has no
variable for a key's passphrase and an argument would show it to other programs, so an encrypted key
works on the session path only.

### Consequences

* Good, because a server that requires certificates is reached from the form, with an encrypted key
  too, and nothing secret is kept anywhere
* Good, because no permission is added and the grant prompt covers both files at once
* Bad, because the key's PEM passes through the plugin's frame on its way to the core, as a typed
  password does
* Bad, because the desk-pg build adds the RustCrypto PKCS#5/#8 crates (AES, PBKDF2, scrypt) beside ring
* Bad, because a passphrase is asked again after every start, and an encrypted key does not work
  for backups and restores

## More Information

Issue #448 (PG-11), plan #438; ADR 0281 (the sessions), ADR 0311 (kept passwords). Code:
`crates/desk-pg/src/client_cert.rs`, `crates/desk-core/src/db_wire.rs`,
`plugins/database/ui/engines/pg-tls.js`. Certificates kept in the OS keychain are out of scope.
