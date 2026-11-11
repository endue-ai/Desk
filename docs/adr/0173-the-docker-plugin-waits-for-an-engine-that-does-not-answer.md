---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0039's "liveness comes from `docker events`, restarted with a backoff": the stream starts
again only once the engine answers; until then the plugin waits for it with `docker version` alone.

# The Docker plugin waits for an engine that does not answer

## Context and Problem Statement

The QA pass (#154; 04 #22, 06 #18) found the Docker window starting a process every 2.3 s for as
long as it was open on a desk with no Docker engine (82 in 188 s, 422 in 25 minutes). The cause
was the reconnect: when `docker events` ended it was started again after 1, 2, 4 … 30 s; its spawn
answered before it failed, so the plugin took the stream for live, asked `docker version` twice
and read the whole overview again (`ps`, `compose ls`, `image ls`, `volume ls`, `network ls`):
eight processes a cycle, forever, also with the window out of sight. The same pass found the lists
saying "Reading…" for good after a read failed, the engine's problem written twice (the banner and
the status line), and the words "Docker is not running" where Docker Desktop ran and only the
context's socket was missing. How does the plugin notice an engine that comes back without running
docker against one that is away?

## Decision Drivers

* No process every few seconds on a desk without an engine; none while the window is out of sight
* The engine coming back (Docker Desktop started, restarted) is noticed without a press, within a
  minute
* A failure only the person can fix (no docker program, the grant refused, a context that is gone)
  is never asked again by itself: a refused grant must not ask the person again and again
* No new bridge method, nothing in the core (ADR 0039)

## Considered Options

* Wait with `docker version`: no event stream and no reads while the engine is away, one
  `docker version` after 5, 10, 20, 40 s and then once a minute, only while the page can be seen
* Keep restarting `docker events` with its backoff, without the extra reads
* Ask only when the person does (Try again, `g`, a tab, a command)
* Watch the endpoint's socket file instead of running docker

## Decision Outcome

Chosen option: "Wait with `docker version`", because one cheap process a minute at most, and none
out of sight, still brings the screen back by itself when the engine returns.

* **Away** (`watch.js`). When the stream ends, the watcher waits 1, 2, 4 … 30 s as before and asks
  `reachable()` (`docker version`) before starting docker again; when no engine answers it stops and
  says `away`. At the start, after a context switch and on Try again, a probe that fails leads to
  the same state. Refresh reads nothing while the probe fails.
* **The wait** (`reach.js`, wired in `follow.js`). Asks `docker version` 5, 10, 20 and 40 s apart and
  then every 60 s, one ask at a time. While the page is hidden (`document.visibilityState`, which
  the desk sets with `WasHidden`) an ask that falls due waits, and showing the page asks at once.
  The first answer starts the event stream and reads the screen again; a list read that works while
  waiting asks at once. Failures of the kinds only the person can fix (`missing`, `unsupported`,
  `denied`, `context`) start no wait.
* **What is said.** The engine's problem names where docker looked and says "not reachable", as the
  header does ("Docker is not reachable at unix:///var/run/docker.sock: start Docker Desktop, …, or
  pick another context, then try again."); it is said in the header and banner (the overview's
  card), not again in the status line. A list whose first read failed says "Could not read the
  images: Docker is not reachable." instead of "Reading…". Escape closes the keys card first.

### Consequences

* Good, because a desk with no engine runs `docker version` 8 times in its first five minutes and
  once a minute after (no other docker process), and nothing while the window is hidden.
* Good, because a refused grant is asked once, not at every reconnect.
* Bad, because an engine that comes back is noticed up to a minute later, or when the window is
  shown again, a list is opened or Try again is pressed; before, it was 30 s at most.
* Bad, because a stream that ends while the engine answers costs one `docker version` more per
  restart.

## More Information

Issues 04 #22 (last item) and 06 #18 of the QA pass (#154, #158, #160). Amends ADR 0039. Code:
`plugins/docker/ui/{reach,follow,watch,engine,docker,shelf,errors,view,view-keys,view-names}.js`.
Tests: `plugins/docker/tests/away.test.ts` (five minutes without an engine: `docker version` only,
at most eight; the engine going away while watched and coming back; a hidden page asks nothing
until shown; a refused grant asked once; lists that could not be read; the wait's timing),
`watch.test.ts` (no stream started against an engine that does not answer), `view.test.ts`,
`engine.test.ts`. No section of `docs/ko/desk-structure.md` changes.
