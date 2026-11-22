# The Database plugin's PostgreSQL sessions

Which session a PostgreSQL run goes to, and what stays on it (ADR 0320). The rest of the plugin is in
[`features.md`](features.md); a change to the sessions adds its line here.

- Each console and each table view keeps a session of its own, opened at its first run, so a SET, a temporary
  table, a prepared statement and a transaction last from one run to the next. A feature's run in a console
  (a `.sql` file run, a routine's call) goes to that console's session.
- The header says the buffer's state in words and a dot: not connected, idle, running, in a transaction, in a
  failed transaction (ROLLBACK needed), or lost.
- In one transaction and a dry run inside an open transaction use a savepoint; a failed transaction refuses
  them and says ROLLBACK first.
- Closing the console, Disconnect, a change to how the connection signs in and removing it close the session,
  asked first while a transaction is open; what was open is rolled back and said so.
- A console can hold a transaction open in Manual commit, with Commit, Rollback, an isolation level and
  savepoints, and closing it or Disconnect asks commit, roll back or stay: [`transactions.md`](transactions.md).
- A session the server ended is said with its reason; the next run opens a new one, says that SET and
  temporary state are gone, and runs nothing again.
- Agents, the explorer, counts, features and grid edits use short sessions, opened and closed around the run.
- Cancel stops only the buffer on screen (and the plugin's own short reads). A run's own signal (the value
  search's Cancel, a table's run past its timeout) cancels that run's statement alone, on its session: a
  kept session stays open with its transaction, a short one closes when its run ends.
- `sessions-per-connection` (8, at most 12) and `session-idle-minutes` (30, 0 keeps them; never one in a
  transaction) bound them; at the limit a table view's idle session goes first.
- After the page wakes, its consoles take back the sessions the core still holds; nothing is opened again.
- Closing the Database window closes the sessions it opened, and so do turning the plugin off and quitting
  the desk; a statement still running is cancelled first, so nothing stays on the server (ADR 0339).
- Disconnect stops every run on the connection. Reads the plugin starts on its own (the activity panel's
  period, a maintenance run's progress) then open no session and say the connection is disconnected; a run
  the person starts, a Refresh by hand included, connects it again.
- A statement's notices are those its pages carry, so they stay with it whatever order things arrive in
  (ADR 0334); a COMMIT's (a deferred trigger's) and those the session sends outside any run are the run's
  own lines, on the next run of a kept session.
- A script's statements go to the session in batches (`db.script`, ADR 0344): 200 statements or 1 MiB
  of SQL a call, each with its own rows, notices and error, so a long script or `.sql` file is not held
  up by a bridge call per statement; the first error still stops it there, and Cancel stops the batch.
- Connecting is asked only from the person's act (ADR 0335): the first run, Test or Connect raises the
  `db:connect` question for a server; the completions read its catalog only once the plugin holds the grant
  (`perm.query`, which asks nothing), so typing never raises it. A refused run says "Allow connecting to
  host:port asks again", and its Messages tab has that button; it and Database: allow connecting ask again
  through `perm.request` with `again`, which the core honours after a refusal earlier in the session.

Modules: `session/` (the kept sessions, their words and limits, `gate.js` for Disconnect, `connect-gate.js` who asks to connect), `engines/pg-session.js` (where a run goes),
`engines/pg-script.js` (how its statements run), `execute.js`.
