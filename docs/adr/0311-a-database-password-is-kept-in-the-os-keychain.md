---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# A database password is kept in the OS keychain, and only the core reads it back

## Context and Problem Statement

ADR 0281 hands a PostgreSQL password to `db.open` once and drops it; `endue.database` asks for it
again after every start unless the person's password file answers. ADR 0281 left `passwordRef`, a
keychain entry the core reads itself, to #443. A person who asks for it should not be asked again
after a restart, and the plugin must still never hold the password it did not just ask for. Where
is the password kept, how does a plugin name it and learn which are kept, and what may it do with
one?

## Decision Drivers

* No path by which a plugin, or script running in its frame, reads a kept password back
* A kept password signs in only to the server it was kept for, wherever a plugin sends `db.open`
* In the OS keychain, as the endue ID session (ADR 0239); never in the store, the state, the logs or
  the history; tests never touch the person's keychain
* The person's password file still answers first, as libpq's does
* Listing what is kept without reading the keychain: an unsigned build may be asked for access at
  every read on macOS
* One credential on Windows holds 2560 bytes at most

## Considered Options

* `db.passwords.*` in the `db` namespace: each password kept for one host, port and user, named by
  the plugin, used by `db.open { passwordRef }`
* A general `secrets.*` namespace behind a new permission, any secret named wherever a call takes a
  reference
* The plugin keeps the password encrypted in its store, with a key the core keeps in the keychain
* One keychain entry per plugin holding all its passwords

## Decision Outcome

Chosen option: "`db.passwords.*` in the `db` namespace", because a database password exists to sign
in to one server: bound to that server it cannot be sent anywhere else, and the namespace that signs
in is the one that keeps it. A general `secrets.*` would be a store nobody else needs yet, with a new
permission to ask for, and a secret not tied to its use goes wherever a later call accepts a
reference. Encrypting in the store hands the plugin the key's use, which is reading it back. One
entry per plugin outgrows a Windows credential with a few long passwords, and one bad write loses
them all.

**Methods.** `db.passwords.set { name, host, port?, user, password }` keeps it (a name is 1 to 64 of
`A-Z a-z 0-9 . _ -`; the same name replaces it; 256 per caller); `db.passwords.delete { name }`
forgets it; `db.passwords.list {}` answers `{ passwords: [{ name, host, port, user }] }`. No call
answers a password. `db.open { passwordRef }` (not with `password`) uses one: the password file
first, then the keychain entry, and the entry only when its host, port and user are the session's;
one that is missing or kept for another server is as if none was given (`needsPassword` when the
server asks).

**Permission.** `set` needs the plugin's manifest to declare `db:connect` covering the host and port
(ADR 0260), and no grant: keeping a password the plugin was just given adds nothing it could not do,
and signing in with it is `db.open`, checked against the grant as before. `delete` and `list` reach
only the caller's own and need nothing, so forgetting always works, also after the grant went.
Agents are refused, as for every `db.*` call.

**Where.** One entry per password in the OS keychain through `desk_sys::keychain` (ADR 0239's
`keyring-core` stores, nothing new), service `ai.endue.desk`, account `db/<plugin>/<name>`, its
secret `{ "host", "port", "user", "password" }`, so the binding is checked against what the keychain
holds. `<data>/db-passwords.json` (mode 0600) says what each plugin keeps, by name with its host,
port and user, so `list` never reads the keychain; it holds no password. An entry gone from the
keychain leaves the index the next time `db.open` misses it. Removing a plugin forgets everything it
kept. Where no keychain answers, `set` is `unsupported` and nothing is kept elsewhere: the fallback
is typing the password, as before.

**The plugin.** `endue.database` offers "Remember the password in the keychain" per PostgreSQL
connection, off by default, in the connection form and in the password prompt; it keeps a typed
password only once a run with it works, a URI's on Save. Its connection records the choice as
`keychain: true`. Removing the connection, unticking the choice, a new host, port or user, and
`Database: forget the remembered password` forget it; plain Disconnect leaves it, and the connection
list marks those kept. The plugin's sessions (`ui/engines/pg-session.js`, PG-01c) send a password
typed this session, else name the kept one by the connection's id (`passwords.ref(conn)`) when
`endpoint(conn)`'s host, port and user are the session's (`ui/keychain.js`), so a kept password signs
in after a restart with no prompt.

### Consequences

* Good, because a person who chooses it is not asked again after a restart, and the plugin never
  holds a password it did not just ask for
* Good, because a kept password signs in only to the host, port and user it was kept for, whatever
  host a plugin names
* Good, because nothing secret is written to the data folder, and listing never reads the keychain
* Bad, because an unsigned development build may see the macOS keychain ask for access at the first
  `db.open` after a rebuild, as for the endue ID session
* Bad, because a plugin that declares `db:connect` keeps up to 256 entries in the person's keychain
  without asking, and the index can drift from the keychain until `db.open` notices
* Bad, because a line in the password file shadows a kept password, so a stale line keeps failing
  until the person edits the file

## More Information

Issue #443 (PG-03), plan #438; ADR 0281 (the sessions and `db:connect`), ADR 0239 (the keychain),
ADR 0260 (the manifest bounds what is asked), ADR 0038 (the plugin's clients). Code:
`crates/desk-core/src/db_passwords.rs`, `crates/desk-core/src/core_db_passwords.rs`,
`plugins/database/ui/keychain.js`. Design: `docs/ko/desk-structure.md`, the database sessions row.
