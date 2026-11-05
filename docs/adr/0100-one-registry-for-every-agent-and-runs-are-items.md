---
status: accepted
date: 2026-11-05
decision-makers: Team endue
---

# One registry for every agent, and runs are items

## Context and Problem Statement

Agents reach the desk from four places: Eris (ADR 0089), the brain's agents and apps over MCP calling as
`agent:<id>` (ADR 0072, 0086), the brain's directory with its A2A tasks, and the programs the local-agents
plugin runs (ADR 0084, 0099). Each kept its own picture: the local-agents board, the shell's A2A chips,
the permission log, approval cards. Nothing said, in one place, which agents there are, which of them are
working, which wait for the person, and what each one did (roadmap milestone M4, killer feature 5, ADR
0093). What is an agent to the desk, what is a piece of its work, and where does one screen read them?

## Decision Drivers

* One record per agent, whatever its source, so any screen and agent can list them alike
* Work must be drawable by every view the desk already has, not by one new screen alone
* No new store to keep in step: grants, init.yaml and runs already hold the facts
* The person stops and approves work from the same place they see it
* Episodes (Eris's memory, #467) and runs must not copy each other

## Considered Options

* A registry computed from what the desk knows (`specs/agent/v0`) and runs as items of kind `run`
* A stored registry and a run log of its own, with a dedicated bridge API for both
* Runs as `task` items with a convention in `raw`

## Decision Outcome

Chosen option: "a computed registry and runs as items", because the item index already feeds every view
(item views, universal views, the palette): a run that is an item shows on a kanban, a list or a timeline
with no new code, and the registry derived on each call can never drift from the grants and runs it reads.
A stored registry would duplicate init.yaml and the grant file; `task` items would mix agents' work into
the person's to-dos.

* **The record.** `AgentRecord` (`specs/agent/v0`): `id`, `name`, `colour?`, `source` (`eris`, `init`,
  `caller`, `directory`, `local`), `caller?`, `brain?`, `tools?` (the allowlist's, else the grants'
  commands), `grants?`, `state` and `runs?`. State comes from runs: `waiting` over `working` over `error`
  (the last run failed) over `idle`.
* **The run.** Item kind `run` (`specs/item/v0`): `agent`, `state` (`running`, `waiting`, `done`, `failed`,
  `cancelled`), `startedAt`, `endedAt?`, `result?` (500 characters at most), `command?`, `approval?`.
  The core records one for every `cmd.invoke` by an agent caller, source `desk.agents`: running from the
  call, waiting with the approval id while held (ADR 0078), ended by the answer. `brain.tasks.list` makes
  each A2A task a run of its target agent. A plugin reports the runs of the agents it runs with
  `agent.report`, under its own source; the registry lists those agents as `<plugin>/<id>`.
* **The bridge.** `agent.list` and `agent.cancel` take `perm:manage`, since they show and stop what agents
  do with their grants; no new permission. `agent.cancel` denies a waiting run's approval, answers a
  running command `cancelled` to its caller, and sends `agent.cancelled` to a reported run's reporter.
* **The board.** `desk.fleet` is a data-only plugin whose command opens a universal kanban over
  `kind: run` (waiting, running, done, failed, cancelled; also a list and a timeline). Its Approve, Deny and
  Stop run commands of the permissions plugin, the `perm:manage` holder. Being a universal view, a person
  can change it and keep their own.
* **Episodes and runs.** An episode is what Eris remembers of a turn (#467); a run is one agent's piece of
  work while it happens and after. Neither links nor copies the other in v0; an episode's steps name the
  commands its runs ran.

### Consequences

* Good, because Claude Code over MCP, an endue agent, Eris and a local program sit on one board, each
  stoppable and approvable, and any view can draw their work.
* Good, because the registry needs no storage and stays true to init.yaml, the grants and the runs.
* Bad, because runs live in memory and in the index for this session; the index keeps them across a
  restart, but the registry's run counts start again at zero.
* Bad, because cancelling a running command only tells its caller: a provider that ignores the lost
  invocation keeps working until it answers, and its late answer is dropped.
* Bad, because a reported run is the plugin's word, as `readOnlyHint` is a server's (ADR 0098).
* Bad, because the board's actions show on every card; Approve on a run that waits for nothing says so.

## More Information

Issue #470. Specs: `specs/agent/v0`, `specs/item/v0` (`RunItem`), `specs/bridge/v0/agent.schema.json`.
Code: `crates/desk-core/src/{agent_runs,core_agents}.rs`, the hooks in `core_cmd.rs`, `approvals.rs` and
`core_directory.rs`; `entriesFromItems` in `packages/plugin-sdk`; `plugins/fleet`; `plugins/permissions/ui/runs.js`;
`plugins/local-agents/ui/report.js`. Builds on ADR 0032, 0072, 0078, 0084, 0087, 0089 and 0099.
