---
status: accepted
date: 2026-11-18
decision-makers: Team endue
---

# An agent runs an installed plugin's commands without a question

## Context and Problem Statement

An agent's call that no grant of its own covers asks the person for its scope (ADR 0072), and a
plugin's commands are an agent's tools (ADR 0088). So the first time Eris ran any command of a plugin,
the person saw "Agent eris asks for permission" for that one command: asked to find commits in Git
Studio, she ran `endue.git-studio.graph` and the answer waited behind a card. The person had installed
Git Studio to use it, and a card per command taught them only to press Allow. When does an agent's use
of a plugin's command need the person's yes?

## Decision Drivers

* The person installed the plugin: that is their decision about what it may do on the desk
* A question that is always answered yes protects nothing and hides the ones that matter
* What cannot be undone still waits for the person (ADR 0078)
* The person's cap on an agent (`agents.<id>.allow`, ADR 0072) stays theirs
* Every agent call stays on the `perm` log

## Considered Options

* Keep the question for every command (ADR 0072 as it was)
* No question for a command marked `readOnly`, a question for the rest
* No question for any command an installed plugin provides
* No question for anything an agent does

## Decision Outcome

Chosen option: "no question for any command an installed plugin provides", because the install is the
person's yes to the plugin and its commands are what the plugin offers; `readOnly` alone would still
ask for a harmless command that shows a view, and dropping every question would reach the bridge's
methods (files, processes, the network), which no install answers.

* An agent's `cmd.invoke` of a registered command whose provider is a plugin in the registry passes
  the check without a grant and without a prompt (`Core::installed_command`, `check_agent`). The call
  is logged `allowed`, as before.
* The cap comes first: a command outside `agents.<id>.allow`, when that list holds anything, is
  refused as before.
* An irreversible command still waits for the person's approval, every time (ADR 0078), and
  `computer.*` acts as before (ADR 0123).
* The desk's own commands (`desk`) and an MCP server's (`mcp:<name>`, ADR 0098) are not a plugin's:
  they ask as before. So do bridge methods an agent calls by name (`fs.*`, `proc.*`, `net.*`).
* `cmd.tools` answers `granted: true` to an agent for such a command.
* A plugin still acts with its own grants only: the command runs in its provider, under the
  permissions its manifest asked for at install.

### Consequences

* Good, because asking Eris about what a plugin shows answers at once, with no card
* Good, because the cards left are the ones that matter: an irreversible act, a file, a process
* Bad, because a prompt-injected agent can run any reversible command of any installed plugin unseen
  until the log is read; the allowlist is the person's way to narrow an agent
* Bad, because a plugin author must mark what cannot be undone `irreversible`: a command that
  forgets it runs without a question

## More Information

Narrows "Inside the cap the usual prompt" of ADR 0072. `crates/desk-core/src/agents.rs`,
`crates/desk-core/tests/agent_command_tools.rs`.
