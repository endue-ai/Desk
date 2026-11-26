---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Terminal protects foreground work and Local agents scopes stopping a run

## Context and Problem Statement

Closing or restarting a terminal could end a live program without asking. Shell integration already
reports when a command takes and leaves the foreground. Local agents had a single stop operation
designed for the person's Activity view, while Eris needs to stop specifically the work it started.
Both surfaces also have current state that Eris can read without moving the person to a different view.

## Decision Drivers

- Preserve ordinary terminal lifecycle, local chat, and board controls.
- Ask once before ending a terminal session with active work.
- Bind a request to stop work to the authenticated caller of its original command.
- Read the rendered terminal scrollback and saved Local agents text through existing models.

## Considered Options

- Check Terminal's foreground state before a forced action and track ownership of Local agents work.
- Classify every terminal close or restart as irreversible and permit any agent to stop a named run.
- Provide separate force commands and migrate existing callers.

## Decision Outcome

An explicit live program is protected. For shells, Terminal uses OSC 133/633 command and prompt
marks, and treats submitted input as active while the shell's state is unknown. Terminal refuses
an ordinary command on a protected session. A direct action or `force: true` asks once, binding
the decision to the session process and the foreground state observed when it asked.
Terminal also marks the session's desk buffer so the desk can review its closure independent of
the unsaved-file preference. Idle shells and exited sessions keep the regular lifecycle.

Eris's terminal search reads the selected xterm scrollback, joins wrapped rows and returns bounded
literal matches without adjusting terminal selection. Sessions report the latest shell-reported
working folder when available. The search bar remains available from the person-facing palette command.

Local agents returns detected agents, board, activity and a bounded saved conversation as data.
A stop request from an agent must name work started by the same authenticated caller. The
desk's existing individual and bulk stop controls remain available, and board execution
stays person-facing under ADR 0099.

## More Information

- TERM-S09 in the Korean terminal requirements.
- ADR 0099, person-controlled execution on the agent board.
- ADR 0249, terminal panes and layout.
