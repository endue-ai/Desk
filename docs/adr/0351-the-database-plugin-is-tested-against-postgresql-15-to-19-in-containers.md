---
status: proposed
date: 2026-11-22
decision-makers: Team endue
---

# The database plugin is tested against PostgreSQL 15 to 19, each in a throwaway container

## Context and Problem Statement

The database plugin's live tests (`plugins/database/tests/*-live.test.ts`) run when a server's URI is in
the environment, which is by hand and against whatever version that server is. A catalog query, a plan
reader or an error format that changes between majors (PostgreSQL 18 stores NOT NULL constraints in
`pg_constraint` with `contype = 'n'`, for one) then fails a person's work rather than a test. Which
servers does the plugin support, and how are its live tests run against each of them?

## Decision Drivers

* One command, on any machine with a container runtime, and one clear line where there is none
* The supported set is written down once and checked against the README
* A run never touches a server it did not start, and leaves no container, volume or file behind
* Beyond the superuser: a role that is not one, a non-default `search_path`, TLS with client certificates

## Considered Options

* The majors the PostgreSQL project still releases fixes for, plus the newest (chosen)
* Those, and the two before them
* The newest major alone

## Decision Outcome

Chosen option: the first, PostgreSQL 15 to 19 on 2026-11-22. 14 had its last release in November 2026;
older servers mostly still work, but nothing tests them.

* **One command.** `just test-pg-versions` (`scripts/pg-versions.mjs`) runs the majors one after another,
  each from the official `postgres:<major>-alpine` image in a container of its own, labelled
  `ai.endue.desk.test=pg-versions`, with a random password, a port Docker picks on 127.0.0.1 and no named
  volume. It removes the container after its version, at the end and on Ctrl-C. `--versions`, `--variants`
  and file names narrow a run. Without a container runtime it prints one line and exits 0.
* **Variants.** `main` runs every live file as the superuser, so a new live file joins by its name.
  `app` runs the live files whose setup needs no superuser right as a role with none (no createdb or
  createrole either), owner of its database, whose `search_path` is `app, public`. `cert` runs
  `client-cert-live.test.ts` on a database pg_hba lets in by `cert` only, with a CA, a server
  certificate for 127.0.0.1 and a client certificate made by the machine's `openssl` for the run.
* **No leaks.** No `ENDUE_DB_TEST_*` URI of the caller's reaches a run; only `ENDUE_DB_TEST_BRIDGE` (a
  built core bridge) passes through.
* **Version differences live in the tests.** A test that reads the catalog tells majors apart where the
  server does (`server_version_num`), not by skipping a version.
* **Known failures are written down.** A file that fails on one major for a reason outside the tests is
  listed in `scripts/pg-versions/known.mjs` with that reason, shown in the table's Known column and not
  counted as a failure. Each entry depends on the machine: today, backup-live with the machine's pg_dump
  older than the server (pg_dump refuses), or 17 and later against a server before 17 (its dump sets
  `transaction_timeout`, which the older server refuses, and the plugin reports the restore as failed).
  An entry goes when its follow-up lands.

### Consequences

* Good, because a version difference fails a test, and the README's set is the tested set.
* Good, because the shared servers other runs use are never reached.
* Bad, because a full run is five majors of every live file, several minutes each.
* Neutral: a variant behind a connection pooler in transaction mode is left for later, since it needs a
  third-party program's image; so is a clear message for a server older than 15, a plugin behaviour.

### Confirmation

`scripts/pg-versions.test.mjs` (in `just test-unit`) checks the set against the README, each variant's
files, the environment a run gets and the skip line; `docs/qa/TESTING.md` says which changes run it.

## More Information

CI belongs to the maintainers. The proposed job, for `.github/workflows/ci.yml`, on Linux runners that
have Docker, after the Rust build:

```yaml
pg-versions:
  runs-on: ubuntu-latest
  timeout-minutes: 90
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22, cache: pnpm }
    - run: pnpm install --frozen-lockfile
    - run: sudo apt-get install -y postgresql-client  # pg_dump and pg_restore for backup-live (known.mjs names the majors it cannot run)
    - run: cargo build -p desk-core --example db-bridge
    - run: ENDUE_DB_TEST_BRIDGE=target/debug/examples/db-bridge node scripts/pg-versions.mjs
```

It would run on pull requests that touch `plugins/database/**`, `crates/desk-pg/**` or
`scripts/pg-versions*`, and nightly on `main`.
