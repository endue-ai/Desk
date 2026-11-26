---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# File choices carry the person's scoped access

## Context and Problem Statement

[ADR 0131](0131-opening-a-file-the-person-chose-grants-its-opener-the-folder.md) grants a viewer
the folder of a file the person opened. [ADR 0119](0119-plugins-drag-desk-data-and-a-drop-hands-over-paths-not-access.md)
passes paths to a drop target. Saving, selecting a destination, attaching an open file and
receiving a drop could still ask for permissions after the person made the choice.

## Decision Drivers

- Carry only the access the choice needs and keep the usual manifest and agent caps.
- Derive the grant from an authenticated caller, native picker or actual drop.
- Keep Save bound to the file in the chosen buffer.

## Considered Options

- Keep the usual scope prompts after every action.
- Carry narrow session grants from verified choices and retain the ordinary permission check.

## Decision Outcome

A folder dialog with destination intent names the write purpose and grants access in the chosen
folder. A save dialog grants read and write to its selected file. Its staging option also grants
write to exactly `.<name>.partial` beside that file.

The runtime records the path of a personally opened buffer. The person's Save grants its opener
write access to that path. Eris's attachment command opens the desk's picker and grants read on
the selected open text file. The built-in Player can request read access to the folders of local
entries it parsed from a personally opened playlist.

Eris can pass a file to the rule-selected opener during a turn the desk or the built-in Eris
surface started for the person. The core verifies that she holds her own lasting read grant for
that file and supplies the verified choice in `cmd.invoked`. Explorer can pass a selected file
that it already has a lasting grant to read. An explicit alternate opener from a plugin or an
agent receives the usual permission check.

At physical drop delivery, the receiving plugin gets read on the dropped paths the host can
validate. A plugin source can transfer only paths covered by its own lasting read grants. When
the built-in Explorer accepts a copy or move into a folder it already displays and can read,
the grant covers that destination. Moves still check the caller's permission over the source.
Standalone windows obtain OS file choices through their trusted drag events.

### Consequences

- Plugins receive normal session grants that the person can revoke in Permissions.
- Plugin code that asks for a wider scope continues to use the ordinary permission path.
- The physical drop carries no grant while a pointer is hovering or after cancellation.

## More Information

- [Issue #721](https://github.com/endue-ai/endue/issues/721)
