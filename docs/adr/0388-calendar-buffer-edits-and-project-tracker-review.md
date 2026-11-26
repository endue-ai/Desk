---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Calendar buffer edits and Project tracker review

## Context and Problem Statement

Calendar reads covered open files while the window also draws system calendars. Its edits assumed
the current file and its permission requests named folders. Projects view controls were unavailable
to agents, and a status-less call could interrupt the person with a picker.

## Decision Drivers

- The events an agent reads include the system layer the person sees.
- A file change names its exact destination and does not move the user's view.
- Review covers one calendar save or one change to a task in a connected tracker.

## Considered Options

- Read the file and system layers separately and keep confirmation on individual edits.
- Share the displayed layer and open buffers, and review changes when they reach a file or tracker.

## Decision Outcome

Calendar includes visible system events and their overlaps in agent reads. System targets are
read-only. File events carry their path, and a repeated id and start across files requires a file
path or buffer id. New event fields fill the editor for the person, while add, update and delete
change an unsaved buffer. The explicit agent save names its file and waits for core review. The
generic agent save points back to the Calendar command for a Calendar buffer. Outside a write grant,
a reviewed agent save leaves the buffer unsaved. The person's Save uses the exact grant from the
desk (ADR 0374).

Projects uses its existing view controls and includes the current view in tasks. A named move must
provide a status. A tracker can notify other people about assignments, dates or status changes, so
the existing move and update tools require core review of a named task. The person can edit through
the window as before.

## More Information

- Issue #737, Calendar and Projects.
- ADR 0078, review of irreversible commands.
- ADR 0374, grants carried by file choices and Save.
