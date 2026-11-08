---
status: accepted
date: 2026-10-28
decision-makers: Team endue
---

# The core holds the brain conversation; plugins talk through brain.say

## Context and Problem Statement

Eris must answer what the person types, using a brain that speaks `specs/brain/v0` (brain-echo today,
endue AI later). Someone has to own the session, its lease, the HTTP client, retries while offline and
the tool calls the brain makes. Plugins are sandboxed frames with `connect-src 'none'` (ADR 0012), and
a session may be written by only one desk at a time. Where does the conversation live, and how does a
plugin reach it?

## Decision Drivers

* Plugins never hold brain credentials or reach the network themselves
* One writer per session: the lease must be enforced in one place
* Offline is a normal state: the turn waits and resumes, it does not fail
* Tools the brain calls run under Desk's permission engine, not inside a plugin
* No async runtime or HTTP dependency in the core for a v0 echo brain

## Considered Options

* desk-core owns the conversation; plugins call `brain.say` (scoped by `brain:converse`) and receive
  their own turns as `brain.turn` events
* Plugins call the brain over `net.fetch`
* A brain plugin that other plugins message

## Decision Outcome

Chosen option: "desk-core owns the conversation". The core keeps the desk id, the session id and the
recent transcript in one file (`SessionStore`), holds the lease (`LeaseClient`), and runs each turn on
its own thread over the `Brain` trait. `desk-brain-endue` implements the trait with a std-only
HTTP/1.1 and Server-Sent Events client; the app points it at `DESK_BRAIN_URL`.

Lease policy: the first turn after Desk starts opens the session with a takeover (opening a session on
this desk makes it the writer); later turns renew a lease past half its ttl, or acquire again without
a takeover. `lease_held` and `lease_lost` leave the desk read-only, and its turns end with an error
line. While the brain is unreachable the turn publishes `offline` with the scenario's sentence,
retries with doubling waits, and publishes `online` when the brain answers again.

The runtime delivers a turn's events only to the plugin whose `brain.say` started it.

### Consequences

* Good, because the brain client, the lease and the tools sit behind the permission engine, and any
  plugin with `brain:converse` gets the same conversation.
* Good, because conformance (`crates/desk-brain/tests/conformance.rs`) and the lease scenarios run
  against brain-echo on every PR.
* Bad, because one session per desk: switching sessions and showing another desk's transcript need
  more bridge methods later.
* Bad, because a stream that breaks mid-answer is retried from the start; the answer restarts.
* Bad, because plain http only. TLS arrives with the real endue AI connection.

## More Information

Bridge: `specs/bridge/v0/brain.schema.json`. Brain contract: `specs/brain/v0/openapi.yaml`.
