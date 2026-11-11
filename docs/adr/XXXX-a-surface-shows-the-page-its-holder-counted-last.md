---
status: proposed
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0151 and ADR 0160 (what the shell reads from a frame's load count).

# A surface shows the page its holder counted last

## Context and Problem Statement

The runtime holds each plugin window's frame and carries out the live budget (ADR 0134, ADR 0156):
it asks a frame for its state, takes it away and puts it back. The desk's page tells the app what it
did in its report (`compositor_desk`, `apps/desk/src/compositor-desk.ts`): each frame's state and
how many pages the runtime asked for (`loads`, `packages/runtime/src/pages/remote.ts`). The page
reports on its animation frames, and about once a second while it draws none (ADR 0164; a locked
screen draws none). desk-wm's `Surfaces` stepped a surface to sleep only when a report said it was
away, and read a new count only for a new document or a dead renderer: a count that moved for a
live surface was taken for a frame the page moved, as iframes once did (ADR 0040).

So a window woken within a report interval of its sleep (a window moved to another desktop and
straight back) kept its old page: the runtime had kept its state for the next page's hello and
stopped hearing the old one, and no new page came. Three agents saw it in the app e2e on a locked
Mac (W1): an old page still running, a woken page that never said hello, answers from the old page.
It is certain for a window put away again just after it woke: its frame keeps a ten-second grace
after loading (`frames/install.ts`), and the sleep at the grace's end comes with no change of the
desk's for the page to report, so the app hears only that the frame is back. What should the shell
do when a sleep and a wake fall between two reports?

## Decision Drivers

* One live page per surface, the one the runtime waits for
* No rule that depends on how often the page reports, or on the screen being unlocked
* No change to the report or the surface protocol (`specs/surface/v0`)

## Considered Options

* The shell follows the runtime's count: a count its page does not stand for loads the page again
* A sleep and a wake that cancel out keep the old page, and the runtime does not count it as reloaded
* The page reports at once whenever a frame goes or comes back

## Decision Outcome

Chosen option: "the shell follows the runtime's count", because once the runtime took a frame away
the old page is stale whether or not the shell closed it: the runtime asked it for its state and
keeps that for the next hello, dropped what it posted while away, and dropped or held what was
posted to the plugin. Only a new page can take up from there. Since ADR 0160 a move in the page
loads nothing, so the count moves exactly when the runtime asks for a page: one more for a new
revision, and each time a frame is back after a sleep, a stop or a death.

* **Live, count moved** (`crates/desk-wm/src/host/surfaces.rs`): the surface loads its document
  again (`Step::Load`), which a web surface's browser navigates and a native plugin restarts its
  program for. Two sleeps and wakes between two reports, or one with a new revision, are one load.
* **Reported away, then back**: sleep and wake as before. A dead surface still waits for its
  holder's new count, then wakes in a new renderer (#44).

### Consequences

* Good, because however the reports fall, the surface ends on one page, the one the runtime waits
  for, which gets the kept state on its hello.
* Good, because nothing changes in the runtime, the report or the protocol.
* Bad, because until the report with the new count arrives (up to about a second while the desk's
  page draws no frames) the old page is still live and the runtime hears it as the frame put back.
  Reporting at once when a frame goes or comes back would shorten that, but never close it.
* Bad, because the old page stays in its browser until the load replaces it: a woken window keeps
  its renderer rather than starting a new one.

## More Information

W1, found while fixing #162. Code: `crates/desk-wm/src/host/surfaces.rs`. Tests:
`crates/desk-wm/src/host/surfaces_tests.rs`, `crates/desk-wm/tests/host.rs` (`never_a_reload`),
`apps/desk/shell/src/compositor_window/hosted_tests.rs`, `e2e/specs/quick-wake.spec.ts`.
