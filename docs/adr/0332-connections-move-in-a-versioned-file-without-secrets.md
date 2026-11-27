---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# Connections move in a versioned JSON file that holds no secret

## Context and Problem Statement

A person moves their database connections to another computer, or hands a set to a colleague
(#452, PG-15). Until now a connection could only be copied as a URI, one at a time. The file is a
persisted format other desks will read for years, and it leaves the computer: whatever it holds
can be mailed, synced or committed. Which format, and what may be in it?

## Decision Drivers

* No password, passphrase, keychain entry or reference to one may ever be in the file (ADR 0311).
* A later desk must recognise an older file, and an older desk must refuse a newer one clearly.
* Importing the same file again must find the connections it made, not duplicate them.
* An import never runs anything and never writes before the person confirms.

## Considered Options

* A list of connection URIs, one per line.
* PostgreSQL's own pg_service.conf as the export format.
* A JSON document of this plugin with a format name and a version.

## Decision Outcome

Chosen option: "a JSON document of this plugin", because URIs and service files cannot carry a
group, a colour, an environment tag, read-only or another engine, and a URI invites a password.

`{ "format": "endue.database.connections", "version": 1, "exported": <ISO time>, "connections": [...] }`.
Each connection carries exactly the fields a connection is made of (`blank()` in `connections.js`),
less any whose name reads like a secret, and never the keychain choice. Its id travels: an import
that meets the same id shows a change, a name already here is skipped unless ticked (then it gets
`Name (2)`). Reading checks every entry as the connection form does and refuses the whole file with
the entry and field named; a field named like a secret refuses it; fields a version-1 desk does not
know are left out; a higher version is refused with "update the desk". pg_service.conf is read as
well, its password left out and said.

### Consequences

* Good, because a password can reach the file by no path: what is written is an allow-list.
* Good, because the version lets the format grow; a new optional field needs no new version.
* Bad, because a shared file tells the receiver each connection's id; ids are random and name no
  secret, and a kept password applies only to its own host, port and user.
* Bad, because a path in a connection (a SQLite file, a CA file) may not exist on the other computer.

## More Information

`plugins/database/ui/features/connections-file/`, `plugins/database/docs/connections-file.md`,
issue #452.
