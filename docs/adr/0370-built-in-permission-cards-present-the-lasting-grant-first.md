---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Built-in permission cards present the lasting grant first

## Context and Problem Statement

[ADR 0029](0029-grants-on-disk.md) gives the person three durations. Built-in plugins that need a
particular folder or network host commonly receive a session grant, so the same question comes back
when endue starts again.

## Decision Drivers

- Let the person keep an explicitly chosen folder or host across restarts.
- Make the duration and the way to revoke it visible before the person answers.
- Keep the refusal and temporary choices easy to reach.

## Considered Options

- Present Always allow first for built-in plugin requests using the existing choice of duration.
- Make all plugin requests prefer the same lasting answer.

## Decision Outcome

Use the plugin registry's `builtIn` field to show Always allow as the first and primary choice, then
Allow this session and Allow once. The card says that the grant can be revoked in Permissions.
Refuse still takes the initial focus. Market plugins, agents and unknown callers keep their existing
choices and ordering.

### Consequences

- Choosing Always allow keeps the existing scoped grant on disk. The Permissions view lists it and
  can revoke it after a restart.
- The parent-folder offer keeps the duration shown on its button. Each refusal stays in the current
  session.

## More Information

- [Issue #722](https://github.com/endue-ai/endue/issues/722)
