# The Database plugin's console transactions

How a PostgreSQL console holds a transaction open across runs (PG-20). The sessions it runs on are in
[`sessions.md`](sessions.md); a change to console transactions adds its line here.

- A console commits in Auto mode (each statement commits by itself, as before) or in Manual mode. The header's
  button and Database: switch the console between auto and manual commit change it; it is kept while the
  console is open, and a console that comes back after a restart is in Auto.
- In Manual mode the first statement of a run on a session outside a transaction goes after a `BEGIN` the
  plugin sends in the same run, after the guards and the confirmation before dangerous statements (which do
  not change). A run that starts with the person's own `BEGIN`, `COMMIT`, `ROLLBACK` or savepoint is left
  alone, and In a transaction and Dry run keep their own savepoint inside an open transaction.
- Commit (`Mod+Shift+Y` in the editor) and Rollback (`Mod+Shift+H`) are commands and header buttons. A failed
  transaction offers only Rollback: Commit is refused, as the server would roll it back.
- While a transaction is open the header shows how many statements it holds and how long it has been open,
  counted each second; the plugin's own control statements are not counted. Once no run used it for
  `transaction-idle-minutes` (5; 0 never) it says idle and the dot turns to danger. Nothing ends it then.
- Database: isolation level and read-only of the next transaction picks the server default, read committed,
  repeatable read or serializable, and read write or read only. The choice goes into each `BEGIN` Manual mode
  sends until it changes, and puts the console in Manual mode; chosen inside a transaction, it applies to the
  next one.
- Database: set a savepoint, roll back to a savepoint and release a savepoint run `SAVEPOINT`, `ROLLBACK TO
  SAVEPOINT` and `RELEASE SAVEPOINT` on the console's session; the last two pick from the transaction's
  savepoints, typed ones included. Rolling back to one keeps the work before it; a failed transaction takes
  only that or Rollback.
- Closing the console or Disconnect while a transaction is open asks once: Commit (when none failed and none
  is running), Roll back (the sessions close, which rolls back) or Stay. The desk closing the console's buffer
  itself, and quitting the desk, cannot be asked: the header says so beforehand, and the transaction is rolled
  back. Removing the connection, a change to how it signs in and moving a console keep their Yes or No question.
- Code: `ui/session/transactions.js` (Manual mode's BEGIN, what the header counts),
  `ui/session/transaction-words.js`, `ui/session/header-view.js`, `ui/features/transactions/`.
