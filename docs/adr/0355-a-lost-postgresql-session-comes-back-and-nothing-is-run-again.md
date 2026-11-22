---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# A lost PostgreSQL session comes back, and nothing of it is run again

## Context and Problem Statement

Consoles and table views keep their PostgreSQL sessions between runs (ADR 0320), and a console can hold
a transaction open across runs (PG-20). A dropped network, a server restart or the computer sleeping
ends such a session without the person. Until now the header said "Session lost" and the next run opened
a new session. The person had no way to reconnect on purpose, a loss inside a transaction did not say what
was rolled back, a session that went quiet during a sleep was found only when a run failed on it, and a
Submit cut off at COMMIT said "Nothing was changed" without knowing. When does a lost session come back,
what does the person see, and what is run on the new session?

## Decision Drivers

* A lost connection costs a reconnect and nothing else: text, results and pending edits stay
* Nothing is replayed: the server rolled the transaction back, and running its statements again on a new
  session, outside it, could do something the person did not mean
* The plugin's own work never asks a question (ADR 0335) and never connects a disconnected connection
  (ADR 0339)
* A Submit's outcome is said as far as it is known, and what is not known is said too

## Considered Options

* Reconnect an idle console's session on its own with a backoff; any other on the next run or on
  Reconnect; never run anything again (chosen)
* Reconnect every lost session on its own, a transaction's included
* Open again only at the next run, as before
* Replay the statements of a lost transaction on the new session

## Decision Outcome

Chosen option: "an idle console's on its own, the rest on the person's act, nothing run again".

* A console's session lost outside a transaction (the server ended it, the network failed, a run found it
  gone, or it did not answer after a sleep) is opened again on its own: tries 1, 2, 4, 8, 16, 30, 30 and
  30 s after the loss, then the plugin waits. Each try is background work: only while `perm.query` shows
  the server's grant, never on a disconnected connection, with no passphrase or password asked; a sign-in
  the server refuses stops the tries. A try opens a session and runs the connection's startup script
  (PG-12), nothing else.
* A session lost inside a transaction, a table view's, and one ended by a revoked grant or the plugin
  stopping is not tried on its own. Reconnect (the header's button beside Session lost, Database: reconnect
  the lost session) opens one at once; the next run does too.
* A transaction lost with its session is said on the status line ("rolled back its open transaction with
  its N statements; none was run again"), listed in the header, and listed once more in the next run's
  Messages. Its statements are kept as text in memory (the first 50, each cut at 200 characters) only for
  that.
* After a sleep (the wall clock ran more than 10 s ahead of the monotonic clock since the session's last
  use), the next run first sends one `SELECT 1` on its session, five seconds at most. A session that does
  not answer is closed and lost; outside a transaction the run goes on on a new session, inside one it
  does not run, because the person meant it to run inside the transaction that went.
* A Submit whose session ended at a change, before COMMIT, says nothing was committed. One whose session
  ended during COMMIT says it is unknown whether the server committed, and to Refresh, then Revert or
  Submit again. The changes stay pending in both.

### Consequences

* Good, because the common case (a blip on an idle console) heals without the person, and the person sees
  every loss in words.
* Good, because nothing the person ran is ever sent twice.
* Bad, because a SET or a temporary table on the lost session is gone after a reconnect; the words say so.
* Bad, because where the monotonic clock counts sleep, the sleep goes unseen and the run itself finds the
  loss, as before.

## More Information

Code: `plugins/database/ui/session/reconnect.js`, `wake.js`, `lost-words.js`, `transactions.js`,
`keeper.js`, `plugin.js`, `ui/edit/submit.js`, `ui/features/reconnect/`. Notes: `plugins/database/docs/sessions.md`.
A result's server cursor (PG-22) follows the same lost state once it exists.
