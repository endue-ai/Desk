---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# Roles and privileges change by the script their dialog shows, and a password leaves the page as a verifier

## Context and Problem Statement

PG-54 (#478) lets the person, and agents, read and change who may do what on a PostgreSQL connection:
roles and their attributes, memberships, every object's grants, default privileges, row security and
policies. PG-50 (ADR 0295) already lists Roles under Server and never reads a password; PG-52 (ADR 0312)
decided that an object operation runs only the script its dialog showed. Privileges add three problems
of their own: a grant held through a chain of memberships is invisible in a plain list of ACLs; a role
reading the catalogs may not be allowed to read all of them; and a role's password is typed into the
page, where a run's text is shown, asked about, kept in history and can reach logs. How is a change shown
and run, how is a role's reach explained, and where does the password go?

## Decision Drivers

* The person reads the exact GRANT, REVOKE, ALTER ROLE, CREATE ROLE or policy statement before it runs
* A password typed for a role never reaches the store, the history, a log, the status line or a model,
  and is never shown back, not even in the script it is part of
* The server keeps only what it would keep from `\password`: no plaintext crosses the wire
* What a role may do through its memberships is explained with the path, not left to be worked out
* A role that may not read a catalog still sees everything else, and is told what it cannot see
* Every name is quoted by the plugin; an agent's arguments never run without the person

## Considered Options

* A dialog per change that shows the exact script, run through `deps.execute` as ADR 0312's are; the
  password turned into a SCRAM-SHA-256 verifier in the page and the script shown with a mask
* The same dialog, with the password sent as plaintext in the statement and the statement kept out of
  history
* The password sent as a bound parameter of a statement the server prepares

## Decision Outcome

Chosen option: "a dialog per change that shows the exact script, and a verifier made in the page",
because it keeps ADR 0312's one rule for every change and is the only option in which the password is
never in a statement's text, on the wire or in the server's log (`log_statement`), whatever its settings.
A bound parameter is not possible: `CREATE ROLE` and `ALTER ROLE` are utility statements and take no
parameters.

* Each change has one dialog (`features/privileges/dialog.js`): the connection with its tag, the fields
  and choices, notes (the grants a CASCADE revoke takes, others' grants a revoke leaves in place), and the
  script written from the same model on every keystroke. The script the dialog showed is the one run, in
  one transaction through `deps.execute`: a read-only connection is refused before the dialog, production
  is asked again, and agents' commands fill the dialog and wait for the person. CASCADE is a choice of
  its own, never implied.
* The page makes the verifier: SASLprep, PBKDF2-HMAC-SHA-256 with 4096 iterations and a 16-byte random
  salt from WebCrypto, then `SCRAM-SHA-256$4096:<salt>$<StoredKey>:<ServerKey>`, as psql's `\password` and
  libpq's `PQencryptPasswordConn` do. The verifier goes as a literal in the statement run; the dialog's
  script and the question before the run (the new `shown` option of `deps.execute`) show
  `PASSWORD '••••••••'`. The dialog's model never holds the password, its answer is cleared once the
  verifier is made, and runs from a feature are not kept in history. A server whose `password_encryption` is
  `md5` stores the SCRAM verifier as given.
* What a role may do is read in one statement: a recursive walk of `pg_auth_members` from the role (with
  INHERIT and SET on 16 and later), then every ACL entry of the catalogs it may read whose grantee is on a
  path, PUBLIC or the role itself, and what it owns. Each privilege is said with how it is held (owns it,
  directly, to PUBLIC, through `ana → reports`) and whether it may grant it on; predefined roles and the
  role's attributes are said as sentences. 2,000 grants at most, the rest counted.
* Before any read the panel asks `has_table_privilege` for each catalog it uses. A section whose catalog
  is not readable says so in its place and its statement is not sent; a statement the server refuses
  anyway says the server's words while the others run.
* Roles are read from `pg_roles` (which masks the password) and never from `pg_authid`.

### Consequences

* Good, because the person and the agent see the same exact script, and a password never leaves the page.
* Good, because a grant through a membership chain is explained in the person's words.
* Bad, because the verifier costs 4096 PBKDF2 rounds in the page, a few milliseconds per change.
* Bad, because SASLprep is approximated by NFKC and the mapped-to-nothing characters, not the whole
  stringprep table; a password with prohibited characters is used as typed, as libpq does.

### Confirmation

`plugins/database/tests/privileges-*.ts`: the SQL and the verifier against a known vector, the model,
the commands over a scripted server (no password column read; the password absent from every store,
model, question and line; only the verifier sent), the panel and the dialog on jsdom, and on a real
PostgreSQL a role created with a password that then logs in, a grant held through a membership, default
privileges, a policy and a catalog the role may not read. `packages/runtime/e2e/database-privileges.spec.ts`
in the runtime page.
