# plugins/database

`endue.database`, a client for PostgreSQL, MySQL / MariaDB and SQLite, in the community folder format and on the
public SDK only. PostgreSQL runs on the core's sessions (`db.*`, ADR 0281), one per console and table view (ADR 0320);
the others run their own client by `proc.spawn`, never a shell, unable to reach past the database (ADR 0038). It keeps
no password; the desk may keep a PostgreSQL one in the OS keychain (ADR 0311); [its connections file](docs/connections-file.md) holds none. [Features](docs/features.md).

`Mod+Shift+B` opens it; every operation is a command `endue.database.*` (`plugin.json`), and
`endue.database.connections`, `.schema`, `.query`, `.search-data`, `.activity`, `.cancel-session`, `.end-session`,
`.maintenance`, `.routine`, `.create-table`, `.change-table`, `.paste`, the objects' and the privileges' commands serve
agents (ADR 0088; a cancel, an end, maintenance, a routine's write, an object's or a privilege's change reach the server
after the person's yes, ADR 0290, 0293, 0312, 0330; a paste or a table form waits for the person, ADR 0324).

## Permissions

The manifest declares these and nothing else (ADR 0260), and `tests/manifest.test.ts` pins them. Those naming
programs, folders or commands are granted at install; the four on `*` and `/**` only let the plugin ask, once per
program, file or server (`perm.request`). None can be narrower: ADR 0260 matches a program by its exact name and a
path by a case-sensitive pattern under one root: only `*` covers a program a setting names, only `/**` any file.

| Permission | What needs it |
| --- | --- |
| `proc:spawn` (`mysql`, `mariadb`, `sqlite3`, `pg_dump`, `pg_restore`) | The MySQL and SQLite clients, and PostgreSQL's programs a backup and a restore run (`features/backup/`), by name, also where the `path` setting finds them (`clients.js`, `run.js`) |
| `fs:write` (`${home}/Downloads/**`) | An export written there (`export.js`), and a cell's bytes saved to a file (`features/cell-values/`) |
| `cmd:invoke` (`desk.palette.pick`, `desk.buffers.open`, `desk.buffers.update`, `desk.buffers.close`, `desk.files.reveal`, `desk.files.changed`) | Picking in the palette, a buffer per console and table, an export shown in the file manager, a `.sql` file changed on disk told to the desk, which asks before unsaved edits are replaced |
| `fs:read` (`/**`) | A `.sql`, `.csv`, `.tsv` or `.json` file dropped on the page (`dropped.js`) or run from disk (`features/consoles/run-file.js`): a drop hands over the path, not access (ADR 0119), so that one file is asked for. A file picked to load a cell's bytes (`features/cell-values/`) is granted by the picker. A file the desk opens with the plugin (a SQLite or `.sql` file) comes with the opener grant (ADR 0131), its folder for the session, so a file from there is not asked for. A PostgreSQL connection's CA file, and its client certificate and key files together (`engines/pg-tls.js`, ADR 0331), are asked for once. A dump a restore reads, and a connections file an import reads, come from the open dialog, which grants them (`features/backup/`, `features/connections-file/`) |
| `fs:write` (`/**`) | Saving a `.sql` file open as a console (`console-files.js`): the opener grant reads only, so that one file is asked for at its first save. A backup's file or folder, which pg_dump writes, is the save dialog's choice and asked for with it (`features/backup/`), as is an exported connections file (`features/connections-file/`) |
| `fs:read` (`${home}/.endue/database/**`) | A console's text past the store's 64 KiB, kept whole in the plugin's own folder (`console-text.js`) |
| `fs:write` (`${home}/.endue/database/**`) | Writing that text there, and the entries a restore chose for `pg_restore --use-list` |
| `proc:spawn` (`*`) | The client a setting (`endue.database.mysql`, `.sqlite3`, `.pg-dump`, `.pg-restore`) names by another name or a full path (`run.js`): that program is asked for at its first run |
| `db:connect` (`*`) | A PostgreSQL session on a connection's host and port (`engines/pg-session.js`, ADR 0281): each server is asked for at its first run; agents never hold one, they go through the plugin's commands. It also lets the plugin keep that server's password in the OS keychain (`keychain.js`, ADR 0311) |

## Tests

```bash
pnpm exec vitest run plugins/database; just test-e2e database.spec.ts  # packages/runtime/e2e: the page at 402×305, 643×339, 900×600
ENDUE_DB_TEST_POSTGRES=postgresql://... ENDUE_DB_TEST_MYSQL=mysql://... pnpm exec vitest run plugins/database/tests/live.test.ts  # PostgreSQL through the core (tests/core-bridge.ts; ENDUE_DB_TEST_BRIDGE=<built db-bridge> reuses a build)
cargo run -p desk-cli -- plugin validate plugins/database
cargo test -p desk-core --test builtin_declarations  # every scope the code uses is declared
```
