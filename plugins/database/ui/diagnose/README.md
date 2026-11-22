# diagnose

The SQL problems a PostgreSQL console underlines as the person types (PG-30, ADR 0294): syntax at
the token PostgreSQL's grammar names, and names the schema cache does not have, in the server's
words. The worker side reads the script; the page side asks for it and draws it.

## Public API

- `check.js` (worker): `createChecker(raw)` → `{ check(request, index), stateAt(doc, offset,
  index), forget(doc) }`. It cuts the script with the plugin's splitter, parses and binds each
  statement under the search path the statements before it left, and keeps each console's
  statements so an edit parses only what changed; `stateAt` replays them for completion (ADR 0327).
  The parse worker answers it as the request `check`.
- `script.js` (worker): what a statement does to the ones after it (search path, created, renamed
  and moved relations, schemas, opaque statements) as effects over a copy-on-write state.
- `names.js`, `insert.js` (worker): the names that bind to nothing and INSERT's counts as
  problems, each with the server's message and hint.
- `text.js`: edit distance, the nearest name, a message as one sentence, where a token ends.
- `model.js` (page): `problemModel(connectionId, view)`, the schema cache's view as the parser's
  model, read schemas only, with the comments, defaults, keys and types completion shows.
- `requests.js` (page): `createChecks(parser)`, one check in flight per console, and the server's
  answers of a run kept by statement text.
- `editor.js` (page): `sqlProblems(act)` → `{ extension, step, recheck, ran }`, the lint
  extension (underline, gutter, hover, F8, Shift+F8, Mod+.) `view-editor.js` registers.
- `diagnose.css`: the lint parts from `--desk-*` tokens.

`features/problems/` holds the three commands and the `problemsContext` action the editor asks.

## How to test

```bash
pnpm exec vitest run plugins/database/tests/problems
ENDUE_DB_TEST_POSTGRES=<scratch database URI> pnpm exec vitest run plugins/database/tests/problems-live.test.ts
just test-e2e e2e/database-problems.spec.ts
```
