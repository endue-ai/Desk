# plugins/database

`endue.database`, a client for PostgreSQL, MySQL / MariaDB and SQLite, in the community folder format and on
the public SDK only. It runs each engine's own command-line client through `proc.spawn`, never a shell, in a
mode that cannot reach past the database (ADR 0038), and never keeps a password. What it does, area by area,
and which modules do it, is in [`docs/features.md`](docs/features.md): a new feature adds its line there.

`Mod+Shift+B` opens it; every operation is a command `endue.database.*` (`plugin.json`), and
`endue.database.connections`, `.schema`, `.query`, `.activity`, `.cancel-session`, `.end-session` and
`.maintenance` serve agents (ADR 0088; the last three change the server only after the person's yes, ADR 0290,
ADR 0293).

## Permissions

The manifest declares these and nothing else (ADR 0260), and `tests/manifest.test.ts` pins them. Those naming
programs, folders or commands are granted at install. The three on `*` and `/**` are granted nothing at
install: they only let the plugin ask, once per program or file (`perm.request`). None can be narrower: ADR 0260
matches a program by its exact name, so only `*` covers one a setting names, and a path by a case-sensitive
pattern under one root, so only `/**` covers a file from any folder or drive, its extension in any case.

| Permission | What needs it |
| --- | --- |
| `proc:spawn` (`psql`, `mysql`, `mariadb`, `sqlite3`, `pg_dump`, `pg_restore`) | The engines' clients, and PostgreSQL's programs a backup and a restore run (`features/backup/`), by name, also where the `path` setting finds them (`clients.js`, `run.js`) |
| `fs:write` (`${home}/Downloads/**`) | An export written there (`export.js`), and a cell's bytes saved to a file (`features/cell-values/`) |
| `cmd:invoke` (`desk.palette.pick`, `desk.buffers.open`, `desk.buffers.update`, `desk.buffers.close`, `desk.files.reveal`, `desk.files.changed`) | Picking in the palette, a buffer per console and table, an export shown in the file manager, a `.sql` file changed on disk told to the desk, which asks before unsaved edits are replaced |
| `fs:read` (`/**`) | A `.sql`, `.csv`, `.tsv` or `.json` file dropped on the page (`dropped.js`) or run from disk (`features/consoles/run-file.js`): a drop hands over the path, not access (ADR 0119), so that one file is asked for. A file picked to load a cell's bytes (`features/cell-values/`) is granted by the picker. A file the desk opens with the plugin (a SQLite or `.sql` file) comes with the opener grant (ADR 0131), its folder for the session, so a file from there is not asked for. A dump a restore reads comes from the open dialog, which grants it (`features/backup/`) |
| `fs:write` (`/**`) | Saving a `.sql` file open as a console (`console-files.js`): the opener grant reads only, so that one file is asked for at its first save. A backup's file or folder, which pg_dump writes, is the save dialog's choice and asked for with it (`features/backup/`) |
| `fs:read` (`${home}/.endue/database/**`) | A console's text past the store's 64 KiB, kept whole in the plugin's own folder (`console-text.js`) |
| `fs:write` (`${home}/.endue/database/**`) | Writing that text there, and the entries a restore chose for `pg_restore --use-list` |
| `proc:spawn` (`*`) | The client a setting (`endue.database.psql`, `.mysql`, `.sqlite3`, `.pg-dump`, `.pg-restore`) names by another name or a full path (`run.js`): that program is asked for at its first run |

## Tests

```bash
pnpm exec vitest run plugins/database; just test-e2e database.spec.ts  # packages/runtime/e2e: the page at 402×305, 643×339, 900×600
ENDUE_DB_TEST_POSTGRES=postgresql://... ENDUE_DB_TEST_MYSQL=mysql://... pnpm exec vitest run plugins/database/tests/live.test.ts
cargo run -p desk-cli -- plugin validate plugins/database
cargo test -p desk-core --test builtin_declarations  # every scope the code uses is declared
```
