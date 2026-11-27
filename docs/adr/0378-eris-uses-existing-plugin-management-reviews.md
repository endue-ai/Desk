---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Eris uses existing plugin management reviews

## Context and Problem Statement

Eris can open plugins. Listing and turning them off, searching the market, reading current
grants and navigating Agents still require their individual windows.

## Decision Drivers

- Keep market permissions and provenance visible to the person before installation.
- Preserve unsaved work and the authority to answer permission prompts.
- Reuse the existing plugin registry and Studio routes.

## Considered Options

- Expose broad plugin and permission management to the agent.
- Register explicit commands backed by the current desk and plugin flows.

## Decision Outcome

The desk lists installed plugins and turns off an exact plugin ID. An agent's turn-off uses the
existing unsaved buffer review. The person controls whether their permission responder is enabled.
The desk can list installed plugins' and agents' grants and revoke an eligible grant by ID.
That tool leaves the authority to answer permission prompts with the person.

Market search uses the installed market configuration. After the irreversible command approval,
the matching Market row opens its existing install review. The person can see the entry's new
permissions and its source. The command waits for the review and the install outcome. The core
checks market trust, bundle hashes and permission acceptance as it does for a direct install.

Agents lists endue Studio agents by the fields needed to identify them. Studio and New agent
open the existing pages. The person creates an agent using the New agent page.

### Consequences

- Agents can use the market and Studio without owning their broader management permissions.
- The install flow keeps both the command approval and the package permission review.
- Permission responder changes still go through the person's management windows.

## More Information

- [Issue #727](https://github.com/endue-ai/endue/issues/727)
- [ADR 0367](0367-agents-run-unasked-only-offered-commands.md)
