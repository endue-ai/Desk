# Session options (PG-12)

A PostgreSQL connection can say how each of its sessions starts, so it behaves the same every time it is
used: in the console, in a table view, in the plugin's own reads, in an agent's query, and after a lost
session signs in again. Server-wide settings are not here.

- The connection form folds them under **Session options** (PostgreSQL only; open when one is set):
  search path, role, time zone, lock timeout, idle in transaction timeout, application name, and a startup
  script. Each is kept only when set (`searchPath`, `role`, `timeZone`, `lockTimeout`, `idleTimeout`,
  `applicationName`, `startup`), so a connection that sets none reads and signs in as before. A change to
  any closes the connection's sessions on Save, asking first while one is in a transaction.
- The first six are startup parameters of `db.open` (`search_path`, `role`, `TimeZone`, `lock_timeout`,
  `idle_in_transaction_session_timeout`, `application_name`): the server takes them at the sign-in, and
  `RESET` or `DISCARD ALL` in a console goes back to them. A role the user may not take, or a time zone the
  server does not know, fails the sign-in with the server's message. Timeouts take PostgreSQL's units
  (`250ms`, `5s`, `1min`) or milliseconds; the search path is schema names separated by commas, a name
  in double quotes kept as written.
- The startup script runs on every new session, right after the sign-in and before anything else, one
  statement at a time under the statement timeout (`engines/pg-startup.js`). A statement that fails ends
  the run with "<connection>'s startup script, statement N: <the server's message>", and that session
  closes. It is checked on Save with a console statement's guards: what no run may send is refused,
  BEGIN, COMMIT and ROLLBACK are refused (each session runs it outside a transaction), and a statement
  that may change data is refused on a read-only or a production connection, where nobody is there to
  confirm it at each sign-in.
- The header shows the role and the search path the connection sets (`as reporting · app, public`) next
  to the database of a PostgreSQL console or table view. A console's own later `SET` is not followed
  there.
- Names without a schema: the explorer's default schema, completion, the SQL problems and go to definition
  read them on the connection's search path, with the role as `$user` (`pathOf`).
- A URI reads and writes `application_name` and `options` with `-c name=value` (or `--name=value`) for the
  five other options, a space in a value escaped with a backslash; another setting in `options` is refused
  by name.
- A connections file carries the six startup options but never the startup script, so a file from
  elsewhere never brings statements that run at each sign-in; an import that changes a connection keeps
  this computer's script while it still passes the guards.
- With an application name of its own, the activity view shows the plugin's sessions as any other; the
  maintenance form finds its run by the session's own application name and sign-in.

Modules: `engines/pg-options.js` (the fields, their checks, the parameters, the URI, the path),
`engines/pg-startup.js`, `engines/pg-session.js`, `connections.js`, `view-form.js`, `view-bars.js`.
Tests: `tests/session-options*.test.ts`, the live `session-options-live.test.ts`, and
`packages/runtime/e2e/database-session-options.spec.ts`.
