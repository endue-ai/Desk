# plugins/database

`endue.database`, a client for PostgreSQL, MySQL / MariaDB and SQLite, in the community folder format and on
the public SDK only. It runs each engine's own command-line client through `proc.spawn`, never a shell, in a
mode that cannot reach past the database (ADR 0038), and never keeps a password. What it does, area by area,
and which modules do it, is in [`docs/features.md`](docs/features.md): a new feature adds its line there.

`Mod+Shift+B` opens it; every operation is a command `endue.database.*` (`plugin.json`), and
`endue.database.connections`, `.schema`, `.query`, `.activity`, `.cancel-session` and `.end-session` serve
agents (ADR 0088; the last two only after the person's yes, ADR 0290).

## Permissions

The manifest declares these and nothing else (ADR 0260), and `tests/manifest.test.ts` pins them. The first
three are granted at install. The last two are granted nothing at install: they only let the plugin ask, once
per program or file (`perm.request`). Neither can be narrower: ADR 0260 matches a program by its exact name, so
only `*` covers one a setting names, and a path by a case-sensitive pattern under one root, so only `/**`
covers a file dropped from any folder or drive, its extension in any case.

| Permission | What needs it |
| --- | --- |
| `proc:spawn` (`psql`, `mysql`, `mariadb`, `sqlite3`) | The engines' clients by name, also where the `path` setting finds them (`clients.js`, `run.js`) |
| `fs:write` (`${home}/Downloads/**`) | An export written there (`export.js`) |
| `cmd:invoke` (`desk.palette.pick`, `desk.buffers.open`, `desk.buffers.update`, `desk.buffers.close`, `desk.files.reveal`) | Picking in the palette, a buffer per console and table, an export shown in the file manager |
| `fs:read` (`/**`) | A `.sql`, `.csv`, `.tsv` or `.json` file dropped on the page (`dropped.js`): a drop hands over the path, not access (ADR 0119), so that one file is asked for. Opening a SQLite file reads nothing (sqlite3 opens it), but the desk's opener grant (ADR 0131) gives its folder for the session, so a file dropped from there is not asked for |
| `proc:spawn` (`*`) | The client a setting (`endue.database.psql`, `.mysql`, `.sqlite3`) names by another name or a full path (`run.js`): that program is asked for at its first run |

## Tests

```bash
pnpm exec vitest run plugins/database; just test-e2e database.spec.ts  # packages/runtime/e2e: the page at 402×305, 643×339, 900×600
ENDUE_DB_TEST_POSTGRES=postgresql://... ENDUE_DB_TEST_MYSQL=mysql://... pnpm exec vitest run plugins/database/tests/live.test.ts
cargo run -p desk-cli -- plugin validate plugins/database
cargo test -p desk-core --test builtin_declarations  # every scope the code uses is declared
```
