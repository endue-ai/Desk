---
status: proposed
date: 2026-11-02
decision-makers: Team endue
---

# Agents are callers: their grants are their own and capped by the person

## Context and Problem Statement

The core holds the brain conversation and runs the tools the brain asks for (ADR 0014). Until now the
only tool was `echo`, which touches nothing, and a tool call said nothing about who asked for it.
Routing the brain's `tool.call` to local tools and commands (CORE-14) means an agent of endue AI acts
on the person's files and commands through the desk. The threat model names the attacker: an agent
holding too many grants, possibly prompt-injected. Under which caller does an agent's call run,
whose grants does it use, what may it ever be granted, and what record is kept of what it did?

## Decision Drivers

* The permission engine is the one gate (ADR 0029 grants, CORE-03 prompts); agents get no second one
* The person, not a plugin, decides what an agent may do: an agent never borrows a plugin's grants
* One agent's grants and refusals are not another's
* The person can cut an agent off without a restart, and sees when an agent is refused
* A record of every grant, refusal and agent call that a person or `desk perm log` can read
* `specs/` first: the brain names the agent; the bridge, init.yaml and the log take the caller

## Considered Options

* Agents are callers `agent:<id>` with grants of their own, capped by `agents.<id>.allow` in init.yaml
* Agents act through the plugin that started the conversation (Eris), with that plugin's grants
* One caller for every brain tool call (`brain`), with one set of grants
* An allowlist alone, without prompts: anything inside it is allowed at once

## Decision Outcome

Chosen option: "agents are callers with grants of their own, capped by the person's allowlist",
because it reuses the engine, the prompt policy, the grant file and the log as they are, keyed by the
caller id, and it keeps the decision with the person.

* **Identity.** `ToolCall.agentId` (`specs/brain/v0`) names the agent that asks. The core runs the
  call as the caller `agent:<agentId>` (the bridge's `CallerId` admits that form). A call without
  `agentId` runs `echo` only. The tools are `echo` and the bridge methods by name, with the call's
  arguments as the method's params; `cmd.invoke` waits for the command's answer (five minutes at most)
  and the provider hears the agent as the caller. The app routes tools through the core with
  `Core::route_tools()`; without it the brain gets `echo` only.
* **Grants are the agent's own.** Grants, refusals remembered by the prompt policy, lasting grants and
  `always` grants in the grant file (ADR 0029) are keyed `agent:<id>`, as for any caller.
* **The cap.** `agents.<id>.allow` in init.yaml lists the permissions and scopes the agent may ever be
  granted. When it holds anything, a call or `perm.request` it does not cover is refused at once:
  `perm.request` answers `reason: "outside-allowlist"`, any other call `permission_denied`, and the
  runtime hears a `ui.notified` from `core` that names the agent. The cap holds at use time, so a grant
  kept from a wider list (session or `always`) allows nothing outside the current one, and the parent
  offer is never made beyond it. An empty or absent list puts no cap: every first use asks. init.yaml
  is read again at every agent check, so an edit applies to the agent's next call; a file that does
  not parse leaves the setup in force.
* **Inside the cap the usual prompt.** An agent's call that no grant of its own covers asks the person
  for the call's scope, for the session (as `shell.open` asks), with the agent as the caller and the
  target as the reason; the answer is remembered per agent.
* **The `perm` log channel** (ADR 0031's log, written by the core): every grant the person makes and
  every grant an agent receives, every refusal of any caller, and every agent call, allowed or denied,
  with `caller`, `permission`, `scope`, `decision` (`granted`, `allowed`, `refused`, `denied`), and
  `target`, `reason`, `duration` and `grantId` where they apply. The host's start-up grants
  (`Core::grant` to built-in plugins, the runtime and the CLI) are made again at every start and are
  not logged. `desk perm log [--agent <id>]` prints it.
* **The permissions view** lists agents under their own heading, apart from plugins, as "Agent <id>".

### Consequences

* Good, because an agent can never be granted what the person did not list, whatever a prompt or a
  prompt-injected agent asks, and a person cuts an agent off by editing one line.
* Good, because grants, refusals and prompts need no agent-specific engine: one check routes agent
  callers through the cap.
* Good, because the log says what each agent did with each grant, which the threat model asked for.
* Bad, because the brain contract changes: `ToolCall` is closed (`additionalProperties: false`), so a
  desk older than this refuses a tool call carrying `agentId`. endue AI must send it only to desks
  that read it.
* Bad, because every bridge method is a tool. A method that needs no scope (an agent's own store,
  settings, log channel, `perm.request`) runs without the allowlist's say, as for any caller.
* Bad, because an empty allowlist means no cap: a person who never edits init.yaml is asked at every
  first use and relies on the prompt alone.
* Bad, because the agent is named by its id: the permissions plugin holds no `brain:converse` to read
  the directory's names.

## More Information

Issue #337, built on #336 (the prompt policy). Code: `crates/desk-core/src/{agents,agent_tools,
perm_log}.rs`, `Core::check` in `core_perm.rs`, `examples/brain-echo` (`tool <name> as <agent>:`),
`crates/desk-cli` (`perm log`), `plugins/permissions`. Specs: `specs/bridge/v0` (`CallerId`,
`RefusalReason`, the `perm` channel), `specs/init/v0` (`agents`), `specs/brain/v0` (`agentId`).
Threat model: "Brain and its lease". Requirements CORE-03 and CORE-14 in
`docs/ko/desk-requirements.md`. #338 adds approvals for an agent's irreversible actions on top.
