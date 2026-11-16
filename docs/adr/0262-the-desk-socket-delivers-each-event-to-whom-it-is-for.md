---
status: accepted
date: 2026-11-16
decision-makers: Team endue
---

# The desk socket delivers each event to whom it is for

Amends ADR 0030.

## Context and Problem Statement

ADR 0030 sent every core event to every socket connection, "as it goes to the webview". The webview
is the desk's own runtime, which routes each event to the plugin it is for (`owners.ts`,
`plugins-events.ts`); the socket did no such routing. So any same-user process on `desk.sock` (the
`desk` CLI, a script, a connection that became `agent:<id>`) received every caller's process output,
socket data, file changes, data subscriptions, web views, Eris's turns and command answers. Review of
#311 found it; #311 kept the microphone's events to their caller as a narrow fix (ADR 0245).

## Decision Drivers

* Caller-private data never reaches another process on the socket
* The socket's own consumers keep working: `desk update check`, desk-mcp's tool refresh, waiting for a
  command's answer
* No change to the bridge's events or to what the runtime hears

## Considered Options

* Route on the socket as the runtime routes for plugins: by address, by owner, by a command's caller
* Address every owned event in the core (`publish_to`), and route on the socket by address alone
* Keep every event for everyone, and filter only known private events

## Decision Outcome

Chosen option: "route on the socket as the runtime routes", because it needs no core change and gives
socket callers the same rule plugins already have.

* **Addressed.** An event with `to` reaches only connections whose caller it names (`cli`, or the
  `agent:*` the connection became). `audio.capturing`, addressed to `desk`, reaches none.
* **Owned.** `brain.turn`, `fs.changed`, `data.changed`, `proc.*`, `net.*` and `web.changed` reach
  only the connection whose call's answer named them (`brain.say`, `fs.watch`, `data.subscribe`,
  `proc.spawn`, `net.connect`, `web.open`), claimed before that answer is written. Events that come
  before their claim wait, 64 per key and for 64 keys; most never get claimed (the runtime's), so they
  fall off.
* **A command's answer.** `cmd.answered` reaches connections whose caller is its `caller`. The core
  keeps sending it to nobody in particular: the runtime routes it to plugins by that field, and
  addressing it would change what the shell's pages hear.
* **The rest.** An event for nobody in particular (`ui.notified`, ...) still reaches every connection.
* **Consumers.** `cli` holds plugin:manage and update:manage, so `plugin.changed` and `update.changed`
  are addressed to it. desk-mcp's watch subscribes to `cmd.changed` (addressed to a command's
  provider) with `events.subscribe`, for which `cli` is granted events:subscribe at start.

### Consequences

* Good, because no process on the socket hears another caller's output, data, turns or answers.
* Good, because the rule is the runtime's own, so a call does the same over the socket and in a plugin.
* Bad, because every `cli` connection is still one caller: what is addressed to `cli`, or answered to
  it, every `cli` connection hears. Owned events are per connection.
* Bad, because a new owned event needs its key in `crates/desk-ipc/src/owned.rs` as well as in the
  runtime's `owners.ts`; until then it reaches every connection.

## More Information

`crates/desk-ipc/src/owned.rs` (the rule), `serve.rs` (claims, early events), tests in
`crates/desk-ipc/tests/addressed.rs`; desk-mcp `src/watch.rs`. Issue #347.
