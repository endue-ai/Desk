---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# Eris opens in the desk

## Context and Problem Statement

The Island (ADR 0204) shows agent activity, permission requests, notices and an Eris input over
other apps. The desk already has a status line, a permission overlay and a talk line. The shell
also supports OS notifications (ADR 0240) and can keep running with its main window closed
(ADR 0225).

## Decision Drivers

- Keep Eris reachable from any app through the existing shortcut and tray menu.
- Retain the desk as the place to answer permission requests and agent approvals.
- Remove the extra window, its settings and its background browser.

## Considered Options

- Keep the Island available through a setting.
- Remove the Island and use the existing desk and OS notification paths.

## Decision Outcome

Remove the Island. The global shortcut and tray action bring the desk forward with the Eris talk
line open. With the desk in front, the action toggles the talk line. Shown notices follow
`desk.notify.system` and the do-not-disturb policy. Permission requests and agent approvals wait
in the desk's permission overlay. `perm.pending` lets prompters restore their queue, and
`perm.settled` reports decisions made elsewhere.

The shell stops reading the old visibility setting and saved placement. Existing configuration
files and browser storage are left alone. Closing the main window continues to leave the core
running, with Search Desk and the tray available.

### Consequences

- The shell no longer creates a persistent panel over other apps or shares Eris's conversation
  through browser storage.
- Seeing agent activity or answering a prompt requires opening the desk.

## More Information

Supersedes [ADR 0204](0204-an-island-floats-over-every-app.md) and updates its references in
[the desk structure](../ko/desk-structure.md). ADR 0205's desk and its pop-out windows stay in force.
