---
status: accepted
date: 2026-10-27
decision-makers: Team endue
---

# Plugin API compatibility: v0 may break, v1 supports the previous major for six months

## Context and Problem Statement

Plugin authors need to know when their plugins will break. The API is still being discovered. What do we
promise, and when?

## Decision Drivers

* Freedom to fix the API while it is young
* A clear, dated promise once people depend on it
* Warnings before anything is removed

## Considered Options

* No promise until 1.0, then semver with a support window
* Strict semver from the first release

## Decision Outcome

Chosen option: "no promise until 1.0, then semver with a support window". v0 states plainly that any
minor release may break plugins. From v1, the previous major version is supported for six months, and
anything removed is deprecated with a warning one version earlier.

### Consequences

* Good, because v0 can change the API as we learn.
* Good, because v1 authors get a dated window and advance warning.
* Bad, because early adopters may need to update their plugins on minor releases.

## More Information

Follows semver and the VS Code extension API. The contract lives in `specs/plugin` and `specs/wit`.
Design: `docs/ko/desk-structure.md`, section "결정".
