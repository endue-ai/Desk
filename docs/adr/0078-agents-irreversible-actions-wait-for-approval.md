---
status: proposed
date: 2026-11-02
decision-makers: Team endue
---

# An agent's irreversible actions wait for the person's approval, with a preview

## Context and Problem Statement

Agents are callers with grants of their own, capped by the person's allowlist (ADR 0072). Inside the
cap the person answers one prompt per scope, and a `session` grant then lets the agent write every file
under it, run its programs and reach its hosts for the rest of the session without the person seeing
any single call. The threat model's attacker is an agent holding too many grants, possibly
prompt-injected: one overwritten document, one `git push --force` or one request carrying the person's
data cannot be taken back. Which of an agent's calls must the person see before they run, what does
the person see, and how does that stay bearable for an agent that writes ten files in one task?

## Decision Drivers

* The person sees what an irreversible call would change before it changes, even under a grant
* The hold sits in the core, where every agent call passes, not in a plugin or in the brain
* A person's own calls (the runtime, the CLI, plugins) are never held
* One answer can cover the rest of a task, so a busy agent is not one card per file
* Fail closed: with nobody to ask, an agent's irreversible call does not run by default
* `specs/` first: the card, the answer and the plugin's `irreversible` flag are contract

## Considered Options

* A card per irreversible call of an agent, with a preview, answered once, for the task, or deny
* Keep one prompt per scope: a grant is the approval (ADR 0072 as it is)
* Let the brain ask the person in the conversation before it calls a tool
* Give agents only `once` grants, so every call prompts for its scope again
* A card for every call of an agent, reversible or not

## Decision Outcome

Chosen option: "a card per irreversible call of an agent", because only the core sees every agent
call and what it would do (the bytes, the command line, the URL), and the brain's word that it asked is
not a guarantee.

* **What is irreversible.** `fs.write` to a path, and `net.fetch` to a host, that no `always` grant of
  the agent allows; every `proc.spawn`; `cmd.invoke` of a command whose provider's manifest marks it
  `contributes.commands[].irreversible` (read when the provider registers it). An `always` grant is
  the person saying "always allow this agent here"; a `session` grant does not exempt a write.
* **When.** After the allowlist cap and the permission check (and its prompt), inside the four
  methods, for `agent:<id>` callers only. Any other caller passes at once.
* **The card.** `perm.approval` to the `perm:manage` holders: the agent, the action, the scope, the
  target and a preview: a unified diff (three lines of context, the first 200 changed lines, files up
  to 1 MiB, both sides UTF-8 text, a new file all additions; else only the size), the command line
  quoted for a POSIX shell, the method and URL, or the command's args (4 KiB). The permissions plugin
  draws it with Deny focused.
* **The answers** (`perm.approve`). `once` runs this call. `task` runs it and lets the agent's later
  calls of the same action through, without a card, while the approved scope covers their target (a
  write's `fs:write` scope, a fetch's `net:fetch` scope, the spawn's one command, the command's one
  id), until the task ends. `deny` refuses the call `permission_denied` (the tool result carries
  `reason: "not-approved"`); it is not remembered, so the next call asks again.
* **The task** is the desk's brain turn the tool call belongs to (`brain.turn`'s `turnId`): it ends
  when the turn ends. The brain contract names no A2A task for a tool call yet; a call outside a turn
  has no task and no "Allow for this task".
* **Nobody to ask.** Without a `perm:manage` holder and a router the Prompter decides, as for prompts:
  yes runs the call once, the default `RefuseAll` refuses it.
* **After.** `perm.approval.done` tells the holders what an approved call did (`ok`, `bytesWritten`,
  the error). Its `undoable` is for `cmd.undo` (#276): set only once the core can take a write back;
  until then the card shows the path and the size written.
* **The record.** The `perm` log channel adds `approved` (with `approval`: `once` or `task`,
  `approvalId` and `task`) and `refused` with `reason: "not-approved"`; `desk perm log` prints them.

### Consequences

* Good, because a prompt-injected agent with a session grant can no longer overwrite, run or send
  anything the person did not see, and the person sees the change itself, not only a scope.
* Good, because one check in the four methods covers every way an agent reaches them.
* Good, because "Allow for this task" keeps a busy turn to one card per action and scope.
* Bad, because more cards: every write of an agent without an `always` grant asks, once per turn at
  best.
* Bad, because an `always` grant turns approvals off for writes and fetches inside it; the permissions
  view is where the person takes it back.
* Bad, because the turn is only an approximation of a task: an A2A task that spans turns asks again
  in each one.
* Bad, because the preview is bounded: a large or binary file shows only its size, a long diff its
  first 200 changed lines, and a fetch its method and URL but not its body.
* Bad, because `irreversible` is the plugin author's word, and a card waits as long as the person
  does, holding the turn, as a prompt does.

## More Information

Issue #338, on #337 (ADR 0072) and #336 (the prompt policy). Code: `crates/desk-core/src/{approvals,
approval_action,approval_preview}.rs`, `Core::hold` in `fs_write`, `proc_spawn`, `net_fetch` and
`cmd_invoke`, the turn passed to `Tools::run`; `plugins/permissions/ui/approval.js`;
`examples/brain-echo` (several tool lines in one turn). Specs: `specs/bridge/v0/perm.schema.json`
(`perm.approval`, `perm.approve`, `perm.approval.done`), `specs/plugin/v0/contributes.schema.json`
(`irreversible`). Threat model: "Brain and its lease".
