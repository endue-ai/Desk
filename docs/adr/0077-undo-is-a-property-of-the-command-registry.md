---
status: accepted
date: 2026-11-03
decision-makers: Team endue
---

# Undo is a property of the command registry

## Context and Problem Statement

Everything a person, a plugin, an agent or the CLI does goes through one command registry (ADR 0017),
and since ADR 0076 every write over a file keeps the bytes it replaced. Command undo was an open question
in `docs/ko/desk-requirements.md`: Mod+Z inside a frame undoes that frame's own text, but nothing undoes
"delete this note", "extract this archive" or a file an agent rewrote. Where does undo live, who can
undo what, and what does a plugin have to write for its commands to be undoable?

## Decision Drivers

* One Mod+Z for the desk: the person does not need to know which plugin or agent did the last thing
* A plugin declares its inverse as data; the desk keeps the history, not each plugin
* Every file write is undoable without plugin work, since the core already keeps its before-image
* The same grants decide who may undo as who may run the inverse
* Additive to bridge v0 (ADR 0004)

## Considered Options

* One desk-level stack in the core, fed by the registry: `undo` names the inverse command
* One stack per plugin (as Emacs keeps one per buffer), each plugin's Mod+Z its own
* Undo only inside plugins, the desk doing nothing
* A transaction log of bridge calls the core replays backwards

## Decision Outcome

Chosen option: "one desk-level stack in the core", because the desk's commands cross buffers and
callers: an agent's write, a CLI restore and a plugin's delete are one history to the person, and the
registry already sees every invocation and its answer.

* `contributes.commands[].undo` and `cmd.register`'s `undo` name the inverse, a command the same
  provider offers; a registration without one takes the manifest's. `cmd.list` shows it.
* When a provider answers an invocation of such a command `ok`, the core pushes `{ command, args,
  result, caller, at, inverse }`. `fs.write` and `fs.restore` push `{ command, args: { path }, result:
  { version }, inverse: "fs.restore" }` whenever they kept a version. Failed answers and writes that
  kept nothing push nothing. A new entry clears the redo side. 200 entries, in memory only.
* `cmd.undo { scope }` pops the newest entry if the `cmd:invoke` scope covers its inverse (else
  `permission_denied` and the stack stays): it invokes the inverse with `{ args, result }` and
  answers that `invocationId`, or restores the write's version itself. The entry moves to the redo
  side; `cmd.redo` runs the command again with its args (a write: restores what the undo replaced),
  and its answer is pushed again without clearing the redo side. An inverse run this way pushes nothing.
* `cmd.undone { entry, by, redo }` goes to the caller and to subscribers. `desk undo` and `desk redo`
  reach the same stack.
* An agent's undo is held for the person like its other calls: the inverse's invocation, or the
  restore's write (ADR 0078).

### Consequences

* Good, because a plugin makes a command undoable with one manifest field and one inverse command, and
  every write is undoable without any.
* Good, because who may undo is the grant model already in place: the runtime and the CLI hold
  `cmd:invoke ["*"]`; a plugin needs a grant covering the inverse.
* Bad, because the stack is the desk's: Mod+Z may undo something done in another plugin than the one in
  front of the person. The notice names what was undone (#279).
* Bad, because the stack is lost on quit; the file versions stay (ADR 0076) and `fs.restore` still
  reaches them.
* Bad, because an inverse is only as good as its plugin: the core cannot check that it undoes.

## More Information

Issue #276. `crates/desk-core/src/core_undo.rs` (the stack, cmd.undo, cmd.redo), `core_cmd.rs`
(invocations and the push on an ok answer), `specs/bridge/v0/cmd.schema.json` (`UndoEntry`),
`packages/bridge/src/stub-undo.ts` (the browser stub's copy). Mod+Z and the plugins' inverses are #279.
