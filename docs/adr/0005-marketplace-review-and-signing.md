---
status: accepted
date: 2026-10-27
decision-makers: Team endue
---

# Marketplace: automatic checks, marketplace signing, manual review only for broad permissions

## Context and Problem Statement

Community plugins will be published to a marketplace. How much do we review, and who signs what users
install?

## Decision Drivers

* Publishing should be fast for the common, low-risk plugin
* Users should know a plugin was not altered after review
* Human attention should go where the risk is

## Considered Options

* Automatic checks for everything, signing by the marketplace, manual review for broad proc/net access
* Manual review for every plugin
* No review; author-signed plugins only

## Decision Outcome

Chosen option: "automatic checks, marketplace signing, manual review for broad permissions". Every
submission is validated automatically (manifest, permission vocabulary, static scan) and signed by the
marketplace when it is published. Only plugins asking for broad `proc` or `net` permissions go to manual
review.

### Consequences

* Good, because most plugins publish without waiting for a person.
* Good, because the installed bytes are the reviewed bytes.
* Bad, because automatic scans miss some malicious behaviour; the bridge permission model is the backstop.

## More Information

Follows the VS Code Marketplace and Obsidian community plugins. `desk plugin validate` (in `crates/desk-cli`)
is the same check run locally and in CI. Design: `docs/ko/desk-structure.md`, section "결정".
