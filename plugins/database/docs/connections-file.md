# Connections file

Database: export connections to a file and Database: import connections from a file move connections
between computers with one file (#452, ADR 0332). Code: `ui/features/connections-file/`.

## Export

The export dialog lists every connection, all ticked (or the ones the command's `connections` names);
Export asks for a place in the desk's save dialog, which grants that one file, and writes it. It says
how many it wrote, without passwords.

## The format, version 1

```json
{
  "format": "endue.database.connections",
  "version": 1,
  "exported": "2026-11-22T09:00:00.000Z",
  "connections": [
    { "id": "c-0a1b2c3d4e", "name": "Shop", "engine": "postgresql", "host": "db.example", "port": 5432,
      "database": "shop", "user": "app", "ssl": "require", "sslCa": "", "file": "", "tag": "production",
      "readOnly": false, "group": "Shop", "color": "chart-2" }
  ]
}
```

- A connection carries the fields a connection is made of and nothing else. No password, passphrase,
  keychain entry or keychain choice is ever written: the writer takes an allow-list, and a field whose
  name reads like a secret (`pass`, `secret`, `token`, `credential`) is never on it.
- `id` is optional (a new one is made); `name` defaults as in the form.
- A reader refuses: another `format`, a `version` above what it reads (update the desk), a field that
  fails the form's checks (the entry and field are named), a non-boolean `readOnly`, a field named like
  a secret, a repeated id or name, more than 1,000 connections or 256 KiB. Fields it does not know are
  left out. A new optional field keeps the version; a change of meaning raises it.

## Import

The open dialog picks the file (granted with it). It is read and checked, never run, and a preview lists
each entry: a change to the connection with its id (ticked; the fields it changes), one already here
(skipped), a name another connection here has (unticked; ticked, added as `Name (2)`), or a new one
(ticked). Nothing is kept until Import. A change keeps this computer's keychain choice; a kept password
whose host, port or user changed is forgotten, and a change to how it signs in closes its sessions
(asked first while one is in a transaction), as Save does.

A `pg_service.conf` imports too: each `[service]` a PostgreSQL connection named after it, from `host`
(or `hostaddr`), `port`, `dbname`, `user`, `sslmode` (`allow` as `prefer`) and `sslrootcert`. Its
`password` and every other key are left out, and the preview names them; a list of hosts or a line that
is not `key=value` refuses the file with its line.
