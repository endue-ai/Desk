---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Eris uses the desk's workspace commands

## Context and Problem Statement

Eris can find windows but has few tools for managing desktops and files, searching the palette,
or reading the run history shown by Fleet. Palette aliases also drop their agent metadata.

## Decision Drivers

- Use the same workspace state, palette providers and undo stack as the desk.
- Preserve the person's control of unsaved files and the permissions of alias targets.
- Let Eris find run records from the same index that Fleet reads.

## Considered Options

- Create a separate agent API for workspace operations.
- Expose explicit workspace commands through the existing registry.

## Decision Outcome

Register tools for desktop management, named open buffers, recent files, file and session
saving, and Sweep snapshots. Desktop removal moves windows. Closing a modified buffer asks
the person. Saving uses the selected buffer and its existing filesystem permissions.

Search queries the palette providers with a group filter and an overall limit. It returns
matching results without invoking their actions. Undo and redo use the desk's command stack.
The run tool reads the indexed run items with an optional state filter and returns the latest
100 summaries across Eris, local and MCP sources.

Manifest aliases publish their command metadata. An alias forwards the agent's identity so the
target checks the same scope and approval. Preset arguments take precedence for agent calls.
Eligible built-in aliases remain discoverable while their autoload plugin is dormant.

### Consequences

- The Today, Fleet and Agents entry points can be discovered and called by name.
- Agent workspace changes reuse the desk's normal state and confirmation behavior.
- Run queries use a desk grant scoped to run items.

## More Information

- [Issue #726](https://github.com/endue-ai/endue/issues/726)
- [ADR 0371](0371-autoload-plugins-declare-their-agent-tools-before-they-run.md)
