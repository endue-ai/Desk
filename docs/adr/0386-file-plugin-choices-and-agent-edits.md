---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# File plugin choices and agent edits

## Context and Problem Statement

Notes could ask for write access while leaving a note. Data and Archives could ask for permission
after someone had already chosen a location. Explorer asked for access to each source folder even
after the desk had delivered a physical drop.

## Decision Drivers

- A file or folder choice carries access to what the person chose.
- An agent edit uses the same buffer, validation and file history as a window edit.
- A masked value stays outside Data's agent search and schema results.

## Considered Options

- Keep the earlier palette choices and request a grant after each choice.
- Use the desk's file and destination dialogs and the scope of the accepted operation.
- Give the plugins broader filesystem grants up front.

## Decision Outcome

Switching notes flushes only a library autosave under existing grants. An outside note waits
for Save. Notes shares show, rename and Trash with the window and protects unsaved typing.

Data resolves a JSON Pointer in the open document and edits a value through the file's own
session, including in the worker. Its text-tier Save suggests a copy in the native file chooser
and writes under that exact file grant. Selecting an outside schema requests its exact read scope.

Archives uses the destination dialog for window extraction and checks an explicit target
folder for a command. Existing paths, entry limits and file history still apply. Explorer's
root picker grants read and write together. System reveal reuses each root's scope and physical
drops use the exact granted sources and destinations. A move still needs source write access.

## More Information

- Issue #735, Notes, Data, Archives and Explorer.
- ADR 0071, Data's editing tiers.
- ADR 0076, file versions.
- ADR 0374, dialog and physical drop grants.
