# The Database plugin's roles and privileges

Who may do what on a PostgreSQL connection, why, and changing it by the exact script (ADR 0330). The rest of
the plugin is in [`features.md`](features.md); a change to roles and privileges adds its line here.

- Database: roles and privileges opens a panel per connection with four tabs: Roles, Object, What a role may
  do, and Default privileges. The explorer's `p` opens it on its row: a role on its view, a table, view,
  sequence, routine, type, schema, language, foreign data wrapper or server, tablespace or the database on its
  privileges. `g` reads again.
- Roles lists every role but the predefined `pg_*` ones from `pg_roles`, with login, superuser, CREATEDB,
  CREATEROLE, replication, BYPASSRLS, INHERIT, the connection limit, VALID UNTIL, its members and what it is a
  member of with ADMIN, INHERIT and SET (16 and later). A password is never read: not `pg_authid`, not
  `rolpassword`, not even whether one is set.
- An object's privileges are a matrix of grantees and the privileges its kind has (MAINTAIN from 17), read
  with `aclexplode` (and `acldefault` when the ACL is NULL, so the owner's and PUBLIC's implicit privileges
  show): the owner first, PUBLIC, then each role, and a table's column grants under their role. A cell is
  none, granted or granted with grant option (✓, ✓*) and names who granted it; pressing it cycles the three.
  Pressed cells are marked and counted, and Review shows them as one script; Discard drops them. A grantee or
  a grantee's column can be added to the matrix first.
- What a role may do is explained, not only listed: the roles it reaches through memberships with the path
  (`ana → reports → pg_read_all_data`), whether it inherits their privileges or may only SET ROLE to them,
  what its own attributes and the predefined roles it reaches let it do (read every table, signal backends),
  and per object each privilege with how it is held: owns it, directly, to PUBLIC, or through a membership
  path, and whether it may grant it on. 2,000 grants are listed at most, the rest counted.
- Default privileges are grouped per owner and schema (or every schema), one matrix each; a new entry
  is a form of owner, schema, kind (tables, sequences, functions, types, schemas), grantee and privileges.
- A table's row security (on, forced) and its policies (command, permissive or restrictive, roles, USING and
  WITH CHECK, read with `pg_get_expr`) show under its matrix, with Change, Drop, New policy and Row security.
- Before reading, it asks the server which catalogs this role may read (`has_table_privilege`). A section
  whose catalog it may not read says so ("app may not read pg_auth_members: memberships cannot be shown.")
  and the others are read; a statement the server refuses anyway says the server's words and the rest still
  run.

## Changes

- Every change opens one dialog with the connection, its tag, the fields and choices, notes on what it does
  beyond its words, and the exact script, written again on each keystroke: GRANT and REVOKE (with GRANT
  OPTION FOR, and CASCADE only as a choice of its own, which a revoke of a grant option others depend on
  needs: those grants are listed), ALTER DEFAULT PRIVILEGES, CREATE ROLE and ALTER ROLE (only what changed),
  GRANT and REVOKE of a membership (WITH ADMIN, INHERIT and SET on 16 and later, `WITH ADMIN OPTION` before),
  CREATE, ALTER and DROP POLICY, and ALTER TABLE ... ROW LEVEL SECURITY. Every name is quoted; PUBLIC is
  written bare. Cancel and Escape run nothing.
- The script shown is the one run, in one transaction through `deps.execute` (ADR 0312): a read-only
  connection is refused before any dialog, production is asked again with its tag, and an agent's call waits
  for the person. A grant of a privilege the object's kind does not have is refused with its name.
- A role's password is typed in a password field. The page turns it into a SCRAM-SHA-256 verifier (4096
  iterations, a random salt, as psql's `\password` does), and only that verifier goes to the server, as a
  literal. The dialog's script and the question before a run show `PASSWORD '••••••••'`; the password is
  never in the store, the history, a log, the status line or the panel's state. PASSWORD NULL is a choice.
- `endue.database.privileges`, `.object-privileges`, `.role-privileges` and `.default-privileges` only read
  and serve agents; `.change-privileges`, `.change-default-privileges`, `.create-role`, `.alter-role`,
  `.change-membership`, `.policy`, `.drop-policy` (irreversible) and `.row-security` fill the dialog from
  their arguments, and the person runs it.

Modules: `features/privileges/`, the `shown` of a run (`execute.js`).
