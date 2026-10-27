---
status: accepted
date: 2026-10-27
decision-makers: Team endue
---

# Ship the web runtime bundle with the app

## Context and Problem Statement

The web runtime (compositor, surfaces, input, layout, theme) could be delivered inside the app or
downloaded and updated separately like plugins. Which one?

## Decision Drivers

* The runtime and the bridge types must always match the Rust core they talk to
* One thing to sign, test and roll back per release
* Plugins still update independently and instantly

## Considered Options

* Bundle the runtime with the app; update only plugins separately
* Deliver the runtime separately from a CDN

## Decision Outcome

Chosen option: "bundle the runtime with the app", because a runtime that drifts from the core it was
built against breaks the bridge contract, and a single signed artifact is easier to test and roll back.
Plugins remain the unit of instant change.

### Consequences

* Good, because each release is one consistent, signed set of core, bridge and runtime.
* Good, because rollback restores all three together.
* Bad, because runtime fixes wait for an app update (the "restart" tier still applies in development).

## More Information

Follows VS Code and Electron apps in general. Design: `docs/ko/desk-structure.md`, section "결정".
