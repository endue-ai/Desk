---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Docker command reviews are reused for exact operations

## Context and Problem Statement

The Docker keyboard surface and Docker Studio have different views over the same Docker CLI.
Eris needs each list and its related operations as commands. Their human controls confirm
destructive actions with the plugin's own UI. Core had already confirmed an irreversible agent
action before the same plugin could run it, so one action could show two confirmations. Opening
a person's container shell also produced a separate Terminal spawn confirmation.

## Decision Drivers

- Preserve each plugin's existing direct actions, keyboard paths, and visible confirmation.
- Keep checks and invocation permissions on the built-in plugin identifiers.
- Reuse the scope of an existing review instead of creating a lasting process grant.
- Return bounded resource data and avoid returning environment or build command values.

## Considered Options

- Reuse exact core command approval in the Docker handlers and Terminal provider.
- Rely on the plugin dialogs for all users and omit the core irreversible flag.
- Keep both prompts and give the Terminal a lasting Docker process grant.

## Decision Outcome

The manifests declare the agent tool definitions. Docker answers the current view and reads
requested folders without changing the view for an agent. Docker Studio splits container actions
into individual commands, and uses the existing Docker CLI models and operations for agent reads
and writes. A legacy action can still dispatch from the palette; starting, stopping, restarting,
pausing and unpausing are ordinary named controls.

Core sets the existing invocation approval marker for supported irreversible Docker operations
only after the command is reviewed and names its target or cleanup scope. A built-in handler
uses that invocation's approval when it calls the same operation used by the window. Direct
operations still take the plugin's existing confirmation path. A tag-removal command operates
on the requested image reference only.

A direct shell action in either Docker surface delegates its exact interactive Docker exec to
the built-in Terminal. Core recognizes the caller and the fixed terminal argument shape,
and attaches the existing one-use PTY approval. The provider has to match the program and
argument vector when it starts the process. Agent-supplied programs and other plugin callers
continue through the ordinary Terminal authorization path.

## More Information

- ADR 0039, the Docker CLI instead of the engine API socket.
- ADR 0263, Docker Studio beside the keyboard-first Docker surface.
- ADR 0379, exact operation confirmation reuse for Database.
