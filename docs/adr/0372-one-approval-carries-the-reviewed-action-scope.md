---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# One approval carries the reviewed action scope

## Context and Problem Statement

[ADR 0078](0078-agents-irreversible-actions-wait-for-approval.md) asks a person to approve an
irreversible action. A first use could also ask for its scope, and Terminal could ask again when it
started the program. The Permissions overlay sometimes asked the person to dismiss the result.

## Decision Drivers

- Review the permission, target and action together while enforcing the existing allowlist.
- Carry approval through a provider only for the operation the person reviewed.
- Give the person an Undo for the exact version kept by a write.

## Considered Options

- Save the approved scope as a session grant for the agent and provider.
- Use the approval as authorization for the checked action and bind any provider operation to its
  pending invocation.

## Decision Outcome

When an action needs review, its approval carries its checked scope. The core still enforces the
agent's allowlist and the target in the request. An ordinary unapproved action uses the existing
scope check. An approved network request's redirects stay on the reviewed host and port.

The built-in Terminal can pass the approved invocation id on its matching PTY spawn. The pending
record matches the provider, program, arguments and any folder named in the reviewed command. It
covers one spawn, and the record ends when the invocation settles. The process can still accept
input, size changes and signals from its own provider.

The Permissions overlay advances when the answer is sent. A successful write that retained a
filesystem version has a completion receipt. The desk's Undo notice restores that receipt's file
and version, and each write under a task approval has its own receipt.

### Consequences

- Approval alone creates no session or persistent scope grant.
- The invocation and Undo paths hold explicit, bounded receipts in the core.
- The approval log remains the record of which action and scope the person reviewed.

## More Information

- [Issue #720](https://github.com/endue-ai/endue/issues/720)
