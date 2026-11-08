---
status: accepted
date: 2026-10-28
decision-makers: Team endue
---

# The brain contract lists agents, spaces and A2A tasks

## Context and Problem Statement

The agent bar shows the person's agents, which ones are working and which wait. endue AI already
defines agents (`/platform/v1/agents`), spaces and agent-to-agent (A2A) cards and tasks, but Desk may
reach endue AI only through public contracts. Where does the agent list come from?

## Decision Drivers

* Closed services stay outside the repository; Desk speaks only `specs/`
* endue AI should serve the list without new concepts, by renaming fields
* Local brains and brain-echo must be able to answer too

## Considered Options

* Add `listAgents`, `getAgentCard`, `listSpaces` and `listA2ATasks` to `specs/brain/v0`, mirroring
  endue AI's models in the contract's camelCase
* Call endue AI's platform API directly from the runtime
* A Desk-only agent model that endue AI translates into

## Decision Outcome

Chosen option: "add them to specs/brain/v0", because endue AI is already a brain and the contract is
where Desk meets it. The schemas follow `AgentGetResponse`, `A2ACardSummary`, `A2ATask` and
`UserSpaceGetResponse` field for field; `specs/brain/v0/README.md` has the mapping. A task's
`progress` (0 to 1) is the only addition. An agent is shown working while a task it was handed is
`working`.

### Consequences

* Good, because brain-echo, local brains and endue AI answer the same operations, tested by
  `crates/desk-brain/tests/directory.rs`.
* Good, because the runtime is typed from the generated contract types.
* Bad, because endue AI must add a space filter on agents (from `space.agent.entered`) and expose
  A2A tasks it keeps internally today.

## More Information

Clients: `Brain::list_agents` and friends (`crates/desk-brain`), `HttpBrain` (`crates/desk-brain-endue`).
The runtime reads them through `ShellBridge.agents`, `.spaces` and `.a2a`; the Tauri adapter comes later.
