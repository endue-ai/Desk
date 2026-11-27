---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# The desk marks its irreversible commands

## Context and Problem Statement

[ADR 0078](0078-agents-irreversible-actions-wait-for-approval.md) holds an agent's call of an
irreversible command for approval. The desk registers its commands directly, so they have no
provider manifest from which the registry can read the marker. Removing a saved profile and
signing out need the same protection if an agent is ever offered these commands.

## Decision Drivers

- Use the existing approval exchange and argument preview.
- Keep the command registry authoritative for both the command list and the tools shown to agents.

## Considered Options

- Keep a separate table of irreversible desk command IDs in the core.
- Let the authenticated desk provider supply the marker with its command registration.

## Decision Outcome

The `desk` caller can supply `irreversible` in `cmd.register`. Plugins use their manifest declaration.
MCP servers keep the rule that commands with side effects are irreversible.

### Consequences

- A desk command's registration carries the marker wherever the command is listed.
- Each agent invocation still needs approval. Combining the marker with `readOnly` is invalid.
- Built-in policies choose the marker independently from whether they offer a tool to agents.

## More Information

- [Bridge command contract](../../specs/bridge/v0/README.md#commands)
- [Issue #718](https://github.com/endue-ai/endue/issues/718)
