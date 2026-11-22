# The Database plugin's live notices and notifications

What a PostgreSQL console hears while a statement runs and while it is idle (PG-25, ADR 0358). The
sessions it runs on are in [`sessions.md`](sessions.md); a change to these adds its line here.

- While a console's run goes on, each notice and warning the server sends shows in the run's Messages tab
  as it arrives, with its severity and context lines, in order (the core's `db.call.notice`). The tab
  keeps the latest 2,000 lines while it runs and says how many it left out. At the run's end Messages is
  the record: every notice on the statement that raised it (ADR 0334). A feature's own reads and a
  routine form still show their notices with their answer.
- After `LISTEN channel` a console's session hears every `NOTIFY` on that channel, from any session of the
  same database, also while the console is idle. Its Notifications tab lists each one: when it came
  (`received`, local time to the millisecond), `channel`, `payload` and the sender's process id (`pid`).
  It is a result: filter, sort, copy and Export (Database: export the console's notifications) work as on
  any. The tab's label says how many are new until it is on screen; its note names the channels.
- A console keeps its latest 1,000 notifications; older ones are dropped and the note says how many. What
  is heard draws at most ten times a second, so thousands a second do not stall the page. Clear (Database:
  clear the console's notifications) empties the list.
- The channels are read from what the console ran: `LISTEN`, `UNLISTEN`, `UNLISTEN *` and `DISCARD ALL`,
  applied at `COMMIT` inside a transaction and dropped at `ROLLBACK`, in a failed transaction and in a dry
  run, as the server does. A `LISTEN` inside a function is not named, though what it hears shows.
- `UNLISTEN` and closing the session stop them. A listening session is never closed for idleness. A session
  that ends, lost or closed, says on the status line and in the tab's note that it stopped listening, and
  on which channels. A reconnect does not listen again on its own (nothing is run again, ADR 0355): Listen
  again, on the tab or Database: listen again on the channels the lost session listened to, runs `LISTEN`
  on each in the console.
- Nothing listens on an agent's behalf: an agent's run that holds `LISTEN` or `UNLISTEN` does not run.
- A connection through a pooler refuses `LISTEN` before it is sent (PG-14, ADR 0354): the pooler lends the
  server connection to other clients between transactions, so a notification would reach whoever holds it.
- After the frame wakes, a console's channels are not known; what its session hears still shows.
- Code: `ui/session/events.js` (what the sessions hear), `raised.js` (a run's live lines), `listen.js` (the
  channels and the list), `listen-tabs.js` (the tabs), `features/notifications/` (Clear, Export, Listen again).
