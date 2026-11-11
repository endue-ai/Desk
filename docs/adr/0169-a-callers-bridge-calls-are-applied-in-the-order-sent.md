---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0153's note that the shell runs each page call on a thread of its own: the calls of one
caller now start in the order they were sent, and the `after` a window call names stays as the
guard for a call let go after the hold.

# A caller's bridge calls are applied in the order it sent them

## Context and Problem Statement

The QA pass (#154, 06 #5) found the terminal scrambling a burst of keys: `ab` reached the shell as
`ba` 3 times in 10, the 26 letters typed in one turn came out shuffled 3 times in 3, `한⏎` as `⏎한`.
The terminal sends one `proc.write` per key without waiting for the one before, as any page may;
the CEF shell (`apps/desk/shell/src/host.rs`) answered every call on a thread of its own, so two
calls of one page raced to the core. Un-awaited `compositor_input` calls of the desk's page
overtook each other the same way. A call may also wait: a `perm.request` for the person's answer,
the file dialog for a choice, `brain.*` and `net.*` for the network, and a call may wait for one its
own page sends after it (a perm:manage holder asking for itself). How does the shell keep the
order a page sent its calls in without one caller's wait holding up another caller, or a call
waiting for good on a later one?

## Decision Drivers

* The calls of one caller are applied in the order sent (06 #5): a page need not await each call
  to keep its effects in order
* One caller's slow or waiting call never holds up another caller's calls
* No call waits for good on a call sent after it; CEF's UI thread never waits for a call
* No change to the bridge's contract or to the core

## Considered Options

* Lanes per caller, each call starting once the one before it ended or has run for a hold
  (250 ms), on threads of their own
* Strict lanes per caller: each call waits for the one before it to end
* A lane per page: the desk's page sends the calls of every plugin it hosts (`desk:calls`)
* Order in the plugins only: each page awaits its calls one at a time (the terminal does, A4)
* A list of methods that wait, let go at once, and strict lanes for the rest

## Decision Outcome

Chosen option: "Lanes per caller with a hold", because it keeps the order of every call that does
not wait and lets a call that waits hold the rest up only so long, so no wait chain can close.

* **Two stages** (`host.rs`, `host/lanes.rs`). A page's calls are read in the order its frame sent
  them, one after another on a strict lane of that frame; each is then queued in its caller's lane:
  the frame and the core caller the call runs as (the desk's page calls for each plugin it hosts
  as that plugin, the palette as `palette`, the floating Eris and the desk as `desk`), or the
  shell's own commands of that frame (`compositor_*`, `desk_*`, the dialog). Lanes run side by
  side; a lane lives while it has work.
* **The hold.** A caller's call starts once the call before it ended or has run for 250 ms. No call
  of a fresh desk's start took longer than 42 ms (a debug build, M4 Max), so a call that does not
  wait keeps its place; a `perm.request` waiting for the person held its plugin's next call
  234 ms and the Permissions plugin's answer not at all; a file dialog with no answer held the
  shell's next command 252 ms.
* **Queueing never waits**: `receive` takes a lock and may start a thread, on CEF's UI thread.

### Consequences

* Good, because the terminal keeps every burst in order with no change of its own (26 letters,
  `ls⏎`, `한⏎`, 216 characters in one turn), and so does any page that does not await its calls.
* Good, because a caller's wait never reaches another caller, and a wait for a later call of its
  own lane ends after the hold.
* Bad, because a call that waits holds its caller's next call up to 250 ms, and a call that does not
  wait yet takes longer (a large read, a write to a full PTY) may be overtaken after it: the order
  holds for what ends within the hold.
* Bad, because a burst of calls takes two threads besides each call's own (its page's reading lane
  and its caller's lane), and the desk's page reads its calls one at a time: a very large call (a
  save of many MB) holds the reading of the next for its parse.

## More Information

Issue 06 #5 of the QA pass (#154). Amends ADR 0153. Code: `apps/desk/shell/src/host.rs`,
`apps/desk/shell/src/host/lanes.rs`. Tests: `host/lanes_tests.rs` (100 calls of varying work in
order, two lanes side by side, a slow lane not holding another, a call waiting for a later one let
go after the hold, queueing never waiting, a panicking job ending alone), `host.rs` (each call's
lane), `crates/desk-core/tests/proc_order.rs` (`proc.write` applied by the time it answers: 100
writes made one after another, each on a thread of its own, heard in order). No section of
`docs/ko/desk-structure.md` changes.
