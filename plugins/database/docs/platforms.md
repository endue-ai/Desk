# The database plugin on macOS, Windows and Linux

PG-102. The same connection and the same habits on the three systems; what differs is said here.

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| PostgreSQL sessions, TLS, client certificate | the core's (`crates/desk-pg`) | same | same |
| Trust store for `verify-ca` / `verify-full` without a CA file | the system's | the system's | the system's |
| Password file (no `PGPASSFILE`) | `~/.pgpass`, owner only | `~/.pgpass`, owner only | `%APPDATA%\postgresql\pgpass.conf` |
| Remembered passwords (ADR 0311) | Keychain | Secret Service | Credential Manager |
| `pg_dump`, `pg_restore` looked for after PATH | Homebrew (`libpq`, `postgresql@<major>`) | `/usr/lib/postgresql/<major>/bin`, `/usr/pgsql-<major>/bin` | `C:\Program Files\PostgreSQL\<major>\bin` |
| Program name | `pg_dump` | `pg_dump` | `pg_dump` (the core finds `pg_dump.exe`) |
| Stopping a program | SIGINT, SIGKILL a second later | same | one kill (Windows has no SIGINT for it) |
| Command line a backup form shows | POSIX shell | POSIX shell | PowerShell (`$env:PGHOST='…'; & pg_dump …`) |
| Paths | `/…`, `~/…` | same | `C:\…` or `C:/…`, `~/…`; read as `C:/…` |
| Mod | Command | Control | Control |

- Majors 13 to 19 are looked for, newest first, after the folders the `path` setting adds; a setting may
  name a program's full path (`C:\Program Files\PostgreSQL\17\bin\pg_dump.exe`), run as it is.
- A `--version` line ending in CRLF reads the same; so do connection service files and `pg_restore --list`
  output with Windows line endings.
- A client key's file mode is not checked by the desk's sessions on any system; `pg_dump` and `pg_restore`
  run libpq, which refuses a key others can read on Unix and checks nothing on Windows.
- Exports and cell files go to `~/Downloads` (`%USERPROFILE%\Downloads` on Windows unless moved).
- The install smoke (`e2e/smoke/install-and-launch.sh`) opens the plugin and runs `select 41 + 1` on the
  server `DESK_SMOKE_POSTGRES` names, through the desk CLI (`e2e/smoke/database-query.mjs`). Windows has
  no desk socket yet, so there it says it skipped.

Modules: `clients.js`, `run.js`, `platform.js`, `engines/pg-tls.js`, `features/backup/args.js`.
