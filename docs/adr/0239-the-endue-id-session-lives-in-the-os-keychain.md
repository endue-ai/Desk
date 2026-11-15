---
status: accepted
date: 2026-11-15
decision-makers: Team endue
---

# The endue ID session lives in the OS keychain

## Context and Problem Statement

The endue ID session (ADR 0089, ADR 0111) is an access token and the `endue_rt` refresh cookie. Until
now both sat in plain text in `<data>/account.json` (mode 0600). A refresh cookie lasts thirty days, so
anything that reads the data folder (a backup, a synced folder, another process of the same user) can
act as the person. Before a first release the session has to be kept where the OS guards secrets.
Connector secrets (`secrets.json`) are out of scope: connectors go through endue.ai and are handled
separately.

## Decision Drivers

* No token on disk in plain text where an OS keychain answers.
* A desk never fails to start, and never signs the person out, because of where the session is kept.
* Pure Rust builds on all three OSes; no libdbus or OpenSSL to install for Linux builds.
* Tests never touch the person's keychain.

## Considered Options

* `keyring` 4, the all-in-one crate.
* `keyring-core` 1 with one native store per target: `apple-native-keyring-store` (login Keychain),
  `windows-native-keyring-store` (Credential Manager), `zbus-secret-service-keyring-store` (Secret
  Service over zbus, `rt-tokio-crypto-rust`).
* Our own bindings: `security-framework`, the `windows` crate's Credential Manager calls and zbus.
* Keep the file and encrypt it with a key from somewhere else.

## Decision Outcome

Chosen option: "`keyring-core` 1 with one native store per target", because it brings only the store
each OS needs (`keyring` 4 alone pulls every store and its CLI's dependencies), it is maintained by the
keyring-rs project under MIT OR Apache-2.0, `security-framework` and zbus 5 are already in the tree, and
our own bindings would be three platform modules to maintain for no gain. Encrypting the file only moves
the question to where the key lives.

The primitive is `desk_sys::keychain` (feature `keychain`): a `Keychain` trait (`get`, `set`, `delete`
of one string), `os(SERVICE)` and a `FakeKeychain`. The session is one entry, service `ai.endue.desk`,
account `endue-id` (`endue-id@<host>` for another platform, so a development session never replaces the
real one), its secret `{ "accessToken", "refreshCookie" }`. `account.json` becomes version 3: when the
token was issued and expires and the profile, no token. A version 2 file moves into the keychain on the
next start (keychain first, then the file). Signing out deletes the entry and the file. Where the
keychain does not answer, the session stays a version 2 file at mode 0600 and the log says so once.

### Consequences

* Good, because the tokens leave the data folder on macOS, Windows and Linux desktops with a Secret
  Service, and `--with-data` copies could never carry them anyway.
* Good, because the fallback keeps today's behaviour where no keychain answers (CI, headless Linux).
* Bad, because an unsigned development build may see the macOS Keychain ask for access after every
  rebuild; signed releases keep their identity across updates.
* Bad, because the session is now in two places, and a version 3 file whose entry is gone reads as
  signed out.

## More Information

Issue #305. Code: `crates/desk-sys/src/keychain.rs`, `crates/desk-core/src/account/vault.rs`. Design:
SYS-06 in `docs/ko/desk-structure.md` (the OS keychain), which this implements for the endue ID session
only.
