---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Network endpoints use reviews at deliberate actions

## Context and Problem Statement

Local models could ask for a remote model server while opening. Network's bulk check
asked again for each device. Screen Sharing requested a session grant even after the
person kept a computer in its list. Eris needs the plugins' reads and named actions
under the same authorities as their direct controls.

## Decision Drivers

- Tie a remote connection request to a deliberate action.
- Keep the scope to the named endpoint, or the exact discovered addresses and fixed ports.
- Keep signed-in remote sessions and background probes under the person's control.

## Considered Options

- Reuse explicit connection scopes with a lasting duration and exact grant revocation.
- Grant a full subnet or all remote model and VNC endpoints.
- Keep independent, temporary questions for every covered connection and device.

## Decision Outcome

The Local models startup uses only existing permissions. Add and Retry request a lasting
grant for the specified endpoint, using the normal re-ask path after a refusal. Eris can
read the installed model and thread summaries and use named models through the same
library, engine and download actions. A delete invocation remains irreversible.

Network's report reads the stored check results without launching a check. The named
device command reuses the existing attached-network validation and common port list.
The person's bulk button reviews the exact discovered addresses and those fixed ports in
one lasting scope, before any connection is tried. The port check sends no data.

Screen Sharing keeps lasting grants for saved addresses and revokes its exact endpoint
grants when an address is removed. Eris selects a saved computer by id or address.
The existing person-facing remote authentication and trust dialogs still own sign-in.

## More Information

- ADR 0133, TCP sockets and Screen Sharing.
- ADR 0267, Local models, managed engines and catalog downloads.
- ADR 0335, permission questions follow deliberate actions.
