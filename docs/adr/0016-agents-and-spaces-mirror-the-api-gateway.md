---
status: accepted
date: 2026-10-28
decision-makers: Team endue
---

# Agents and spaces mirror endue AI's API gateway

## Context and Problem Statement

The agent bar shows the person's agents and the spaces they work in. endue AI already serves both
through its API gateway (`platform/apps/api-gateway`): `GET /api/v1/agents`, `GET /api/v1/spaces` and
`GET /api/v1/spaces/{id}/agents`, behind an endue ID token. Desk may reach endue AI only through public
contracts. How does the agent list reach Desk?

## Decision Drivers

* Closed services stay outside the repository; Desk speaks only `specs/`
* No translation layer: endue AI's gateway should answer Desk as it answers its own web app
* brain-echo and local brains must be able to answer too

## Considered Options

* Mirror the three gateway routes in `specs/brain/v0`: same paths, same snake_case shapes
* Keep Desk's own camelCase agent model and map gateway answers into it in the endue client
* Call the gateway from the runtime without a contract

## Decision Outcome

Chosen option: "mirror the gateway routes", because the gateway is the contract endue AI already
keeps. `listAgents`, `listSpaces` and `listSpaceAgents` sit at `/api/v1/...` with per-path servers
(`https://platform.endue.ai`, or brain-echo at its root). Schemas are open, since the gateway may add
fields. `HttpBrain` calls them on the gateway origin with the endue ID token.

### Consequences

* Good, because pointing Desk at the gateway needs no mapping, and brain-echo answers the same shapes.
* Good, because the runtime is typed from the generated contract types.
* Bad, because the contract has two naming styles: camelCase for sessions and turns, snake_case for
  the gateway routes.
* Bad, because the gateway has no "working now" signal yet, so the working dot and running chips still
  come from local data.

## More Information

Tests: `crates/desk-brain/tests/directory.rs` (brain-echo and `HttpBrain`), the runtime's
`src/bridge/directory.test.ts` and `e2e/shell-system.spec.ts`.
