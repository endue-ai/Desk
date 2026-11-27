---
status: accepted
date: 2026-11-24
decision-makers: Team endue
---

# Agents run unasked only the commands a plugin offers them

## Context and Problem Statement

ADR 0268 let an agent run any command of an installed plugin without a question, on the grounds that
installing the plugin was the person's yes to what it offers. But a plugin offers agents only what it
marks `agent` (ADR 0088). The rest are the person's own: buttons, palette entries and the commands that
other parts of the desk call, such as the Permissions plugin's answers to an approval. An agent reaches
those too, by id through `desk-run` or over MCP, so ADR 0268 let it run what no plugin had offered it.
Three more places gave an agent more than its own call would get: a mail draft was sent or discarded
with no approval; Universal View ran a `command` source, as itself and before anyone said yes, from a
view an agent passed inline or proposed; and an "Allow for this task" answer for a computer act that
reaches no known app was kept without an app, so it let every later act of the turn through. What does
an agent run without a question, and what is held back?

## Decision Drivers

* The install is a yes to what the plugin offers agents, not to everything it does for the person
* An agent never answers the person's questions, its own or another agent's
* A plugin acts under its own grants: what it runs for an agent must not reach past the agent's check
* An answer for the task covers one target, never all of them
* Questions stay few: what was offered stays unasked (ADR 0268, ADR 0296)

## Considered Options

* Keep ADR 0268 as it is, and fix each plugin that exposes something
* An agent runs only commands marked `agent`; the rest are refused
* An agent runs commands marked `agent` without a question; the rest ask, as any uncovered call does

## Decision Outcome

Chosen option: "commands marked `agent` run unasked, the rest ask", because desk-mcp offers an MCP
client every command and calls as an agent, so refusing the rest would break what the person set up
there, while asking keeps it possible and keeps the person in the loop.

* `Core::installed_command` passes an agent's `cmd.invoke` without a question only when the command is
  marked `agent` and its provider is an installed plugin. Any other command asks the person for its
  scope, once per session, as ADR 0072 said; a grant still covers it.
* No agent runs any command of a plugin whose manifest declares `perm:manage`, whatever it holds
  (`answers_for_the_person`), and such commands are no agent's tools (`agent_commands`). The refusal
  is logged.
* `endue.mail.send` and `endue.mail.discard` are `irreversible`, like `send-message` and `rsvp`.
* The database console's runs, commits, transfers and forget commands refuse an agent or an MCP
  caller in the plugin's gate: agents read through `endue.database.query`, read-only and masked
  (ADR 0346).
* A plugin's command handler gets who invoked it, `{ invocationId, caller }`, as a second argument
  (`@endue-ai/plugin-sdk`). Universal View uses it to refuse a `command` source in a view an agent
  passes inline; a saved view opened by id opens as before. A view Eris proposes may read only a
  `readOnly` command (`changingSource`), and `desk.universal.folder` is marked `readOnly`.
* A `task` answer is offered only for an act it can be narrowed to (`Action::narrows`): a computer
  act that reaches no known app is approved once at a time, and `perm.approve` refuses a `task` answer
  for it.

### Consequences

* Good, because an agent cannot answer an approval or run the person's own commands unseen
* Good, because what plugins offer agents stays free of cards, as ADR 0268 wanted
* Bad, because a command an agent used to run unasked, without the `agent` mark, now asks once per
  session; plugin authors mark what they offer agents (`docs/plugins/authoring.md`)
* Bad, because an agent's inline Universal view cannot read a command; it proposes the view or names
  a saved one

## More Information

Narrows ADR 0268 and ADR 0123 ("Allow for this task"); keeps ADR 0078. Parent issue #716. Code:
`crates/desk-core/src/agents.rs`, `crates/desk-core/src/approvals.rs`,
`crates/desk-core/src/approval_action.rs`, `packages/plugin-sdk/src/commands.ts`,
`packages/runtime/src/propose/universal.ts`, `plugins/universal/ui/agents.js`,
`plugins/database/ui/features/audit/gate.js`, `plugins/mail/plugin.json`. Tests:
`crates/desk-core/tests/agent_gate.rs`, `crates/desk-core/tests/computer/agents.rs`.
