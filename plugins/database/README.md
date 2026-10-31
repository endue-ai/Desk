# plugins/database

`endue.database`, a database client for PostgreSQL, MySQL / MariaDB and SQLite, in the community folder
format and on the public SDK only. One `center` surface holds the connections and an explorer of schemas,
tables and columns on the left, and a SQL console (or a table's rows) over the results on the right.
`Mod+Shift+B` opens it; every operation is a command (`endue.database.*`), and `.connections`, `.schema`
and `.query` take an argument schema for Eris and agents. `*.sqlite`, `*.sqlite3` and `*.db3` open as
SQLite connections. Design and requirements: `docs/ko/database-plugin-requirements.md`, ADR 0038.

It runs each engine's own client through `proc.spawn`, never a shell, each in a mode that cannot reach
past the database: `psql -X -w` with one `-c` per statement (sent to the server as written, so `\!` and
the other meta-commands never run), `mysql --binary-mode --local-infile=0`, `sqlite3 -safe`. Markers
after each statement split the output; `--csv` with a random NULL text, `--xml` and SQLite's quote mode
keep NULL, `''` and `'NULL'` apart. The first error ends a run and says where it is in the editor.

Passwords are never kept: the clients' own files (`~/.pgpass`, `~/.my.cnf`) work as they are, and when a
server asks, the person types it once per session; it reaches the client through `PGPASSWORD` or
`MYSQL_PWD`, never an argument, the store or the log. Read-only connections refuse writes before the
client starts and open the session read-only on the server too. Production connections, DROP, TRUNCATE,
and UPDATE or DELETE without WHERE ask first; an agent's write always asks.

| Permission | Why |
| --- | --- |
| `proc:spawn` (`psql`, `mysql`, `mariadb`, `sqlite3`) | Run the engines' clients, and only them |
| `cmd:invoke` (`desk.palette.pick`, `desk.buffers.open`, `.update`, `.close`) | Ask and confirm, be a buffer per console and table |

| Files | Purpose |
| --- | --- |
| `ui/sql/` | The lexer, statements cut per dialect, what each one does, quoting |
| `ui/engines/` | Per engine: the client's arguments, reading its output and errors, the catalog queries |
| `ui/run.js`, `clients.js`, `execute.js` | Processes, finding clients and versions, checks and confirmations before a run |
| `ui/connections.js`, `manage.js`, `catalog.js`, `explorer.js` | Connections and URIs, the form, the explorer |
| `ui/consoles.js`, `tabs.js`, `results.js`, `history.js`, `agent.js` | Consoles and tables, results, history, agents |
| `ui/database.js`, `view*.js`, `keys.js` | The controller, the DOM, the keys |

```bash
pnpm exec vitest run plugins/database
ENDUE_DB_TEST_POSTGRES=postgresql://... ENDUE_DB_TEST_MYSQL=mysql://... pnpm exec vitest run plugins/database/tests/live.test.ts
cargo run -p desk-cli -- plugin validate plugins/database
```
