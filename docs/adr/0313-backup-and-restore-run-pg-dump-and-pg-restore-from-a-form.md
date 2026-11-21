---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# Backup and restore run pg_dump and pg_restore from a form

## Context and Problem Statement

PG-62 (#483) backs up a PostgreSQL database and restores one from `endue.database`. Only PostgreSQL's own
programs read and write every kind of object, every format and every version's archive right: `pg_dump`
and `pg_restore`. A backup writes a file or folder the person names, and a restore changes a database, often
all of it. How are the programs found, run and given the password, where may they write, and what guards
a restore?

## Decision Drivers

* No shell, ever (ADR 0038): each option one argument, nothing interpolated
* The person sees the exact command before it runs, and never the password in it
* A program too old for the server says so before it runs, not halfway through
* A backup writes only where the person said; the manifest's declarations bound what can be asked (ADR 0260)
* A restore is a write: read-only refuses it, production asks, an agent waits for the person
* A long run is heard as it goes and can be cancelled

## Considered Options

* `pg_dump` and `pg_restore` spawned by name as programs, from a form, in a log panel
* SQL the plugin writes itself (`COPY` and the catalog's DDL) to back up and restore
* Hand the command line to the terminal plugin and let the person run it

## Decision Outcome

Chosen option: "`pg_dump` and `pg_restore` spawned by name as programs", because only they handle every
object and format, and a form over them keeps the command visible while the plugin keeps the guards. The
plugin's own PostgreSQL needs no client program (its sessions are the core's, ADR 0281); these two are the
only PostgreSQL programs it runs.

* The programs: found as the MySQL and SQLite clients are (`clients.js`): by name, by their own settings
  `endue.database.pg-dump` and `endue.database.pg-restore`, on the desk's PATH, in the `path` setting's
  folders or where libpq installs them. The manifest's `proc:spawn` names them, so they are granted at
  install like the clients; a setting naming another program stays under `proc:spawn` of `*`, asked at its
  first run. Each must be at least the server's major version (`SHOW server_version_num`, read on a session
  of the core's), or the plugin says which is needed and how to name one; older than 13 is not used.
* The connection: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSSLMODE` and the rest in the program's
  environment; `pg_restore` gets `--dbname=<database>`, quoted as `dbname='…'` when the name could read as a
  connection string. The password typed this session goes in `PGPASSWORD` of the spawned program's
  environment only; otherwise libpq reads `~/.pgpass`. Both run with `--no-password`, so they never wait on a
  prompt. The command line shown leaves `PGPASSWORD` out.
* Where: the backup's target comes from the desk's save dialog and its grant is asked with `perm.request`
  (`fs:write` of that path); the dump to restore comes from the open dialog, which grants it. A path under
  the home folder is passed relative to it (the programs start there), so no path starts with `-`. The
  chosen entries go to a list file in the plugin's folder (`~/.endue/database/restore/<id>.list`) for
  `--use-list`.
* The forms: the backup's format (custom, directory, tar, plain), what (database, schemas, tables), content,
  owner and privileges, compression (custom and directory; lz4 and zstd from pg_dump 16), jobs (directory)
  and INSERTs (plain, on by default); the restore's target connection, clean, if-exists, create, content,
  owner, privileges, jobs (not tar), one transaction (one job, no create) and the entries `pg_restore --list`
  reads. Each change redraws the exact command; what cannot run is said under it and holds the button.
* The guards: a restore into a read-only connection is refused; into production it is asked first with
  the connection, the database, the host and what clean and create do, whatever the `confirm` setting. The
  commands are agents' tools (`.restore` irreversible), but an agent's arguments only fill the form: nothing
  runs until the person submits it.
* A plain SQL file is restored as a script through run-file (PG-24) on the core's sessions; run-file refuses
  `COPY … FROM stdin`, which is why a plain backup defaults to INSERTs. pg_dump 17.6 and later write
  `\restrict` and `\unrestrict` guard lines in a plain file; the script reader reads exactly those as
  blanks, and any other backslash line is refused as before.
* The run: a log panel with the command, the verbose lines as they come (the last 1,000 kept), tables
  written or entries restored, Cancel (SIGINT, then SIGKILL a second later) and what came of it, with the
  size written. A long `--list` is read in a worker.

### Consequences

* Good, because the archives are PostgreSQL's own: any `pg_restore` reads them, and the plugin reads any
  `pg_dump`'s
* Good, because the person sees and could copy the exact command, with no password in it
* Good, because writes land only where a dialog named, under a grant asked for that path alone
* Bad, because the programs must be installed and new enough; the plugin says how, but cannot ship them
* Bad, because a plain file runs in parts through run-file, statement by statement, slower than `psql -f`
  on a large dump; custom or directory suits those
* Bad, because the manifest now names two more programs granted at install

### Confirmation

`plugins/database/tests/backup-args.test.ts`, `backup-toc.test.ts`, `backup.test.ts`, `backup-form.test.ts`,
`script-restrict.test.ts` and `manifest.test.ts`; `backup-live.test.ts` against a real PostgreSQL (a schema
backed up in custom, directory and plain format, restored into a fresh database with equal row counts and
checksum; a read-only connection refused); `packages/runtime/e2e/database-backup.spec.ts`.

## More Information

`plugins/database/ui/features/backup/`, `plugins/database/ui/clients.js`, `plugins/database/plugin.json`.
Builds on ADR 0038 (no shell), ADR 0088 (agents' tools), ADR 0260 (declarations), ADR 0281 (the core's
sessions) and PG-24's run-file (ADR 0286).
