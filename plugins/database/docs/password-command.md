# Password commands and poolers (PG-14)

Some servers hand out passwords that expire after minutes, made by a program the person already uses;
others are reached through a connection pooler. A PostgreSQL connection can say both (ADR 0354).

## A password command

- The form's **Password command** (PostgreSQL only) is a program and its arguments on one line:
  `/usr/local/bin/db-token --user app --label "shop db"`. Words are split on spaces; a word with spaces
  or quotes goes in double quotes (`\"` and `\\` inside). Nothing a shell does happens: no variables,
  globs, pipes or `~`. The program is a name found on PATH or a full path starting with `/`. The
  connection keeps the line (`passwordCommand`) in one spelling, and a change closes its sessions on Save.
- What the program prints on its first line is the password. It runs for every new session (a console's,
  a table view's, the plugin's own reads, an agent's query, a lost session signing in again), nothing is
  cached, and the password goes into that session's sign-in only: it is never kept, logged, shown, put in
  the history or in the keychain. A connection with a command cannot also keep a password in the keychain.
- When the server refuses the password (SQLSTATE `28P01` or `28000`), the command runs once more and the
  sign-in is tried again: a short-lived password may have expired in between. A second refusal ends the run
  with "<host:port> refused the password <connection>'s password command printed, also after it ran again"
  and the server's message; no password prompt opens, since the command is where the password comes from.
- A command that fails ends the run with "<connection>'s password command exited with <code>: <the first
  line of its standard error>"; one that prints nothing, or takes over 30 s, says that.
- Before a command first runs on this desk, the palette asks "run a program to get <connection>'s
  password?" with the command under Yes. The yes is kept in the plugin's store (`password-commands`, by
  connection id, the command only), so a command that came another way (a hand-edited store, a changed
  command) never runs unseen. Then the desk asks once to let the plugin run that program by name
  (`proc:spawn` on `*`), as for any client a setting names. The database clients the plugin runs without
  asking (`mysql`, `mariadb`, `sqlite3`, `pg_dump`, `pg_restore`) cannot be a password command.
- The connections file carries no command (`connections-file.md`), and a URI has none.

## Through a pooler

A pooler in transaction mode lends a server connection for one transaction at a time, so what a session
keeps between transactions may be gone at the next, or seen by someone else. **Through a pooler in
transaction mode** (`pooler`) makes the plugin rely on none of it:

- Sessions sign in with the application name alone. The plugin's own startup parameters (the statement
  timeout, ISO dates, the read-only default) are not sent: a pooler refuses or drops them. The statement
  timeout is then the plugin's own stop (a cancel past the timeout and five seconds, then the session
  closes), and a read-only connection is held by the plugin's guard, which refuses writes before they go.
- A kept session takes no `SET statement_timeout` when the setting changes.
- Session options and a startup script cannot be set on such a connection: set them on the pooler or the
  role (`ALTER ROLE … SET`) instead. The application name can.
- A run is refused in words, before anything is sent, when a statement keeps state on the session: `SET`
  (but `SET LOCAL`, `SET TRANSACTION` and `SET CONSTRAINTS`), `RESET`, `LISTEN`/`UNLISTEN`, `PREPARE`,
  `EXECUTE`, `DEALLOCATE`, `DECLARE … WITH HOLD`, a temporary table without `ON COMMIT DROP`, `DISCARD`,
  `LOAD` and a session advisory lock. Features that run such statements themselves (maintenance's lock
  timeout, the audit check's `PREPARE`) are refused the same way.
- What works: reads, runs, a statement's pages (the core keeps its portal open until the statement ends),
  edits, explicit transactions within one run or across a console's runs, `SET LOCAL`, the catalog and
  the explorer. The core prepares only unnamed statements, which a pooler in transaction mode passes.

Tests: `tests/password-command.test.ts`, `password-command-sessions.test.ts`, `pooler.test.ts`, and
`password-command-live.test.ts` against a real server (`ENDUE_DB_TEST_POSTGRES`; with
`ENDUE_DB_TEST_POOLER`, a pooler in transaction mode in front of the same database, also through it).
