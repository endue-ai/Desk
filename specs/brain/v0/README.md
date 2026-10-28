# Desk brain API v0

`openapi.yaml` (OpenAPI 3.1) is the contract between Desk and a brain. The local brain adapter, endue AI
and `examples/brain-echo` implement it; `crates/desk-brain-*` are its clients.

| Area | Operations |
| --- | --- |
| Sessions | `createSession`, `getSession` |
| Turns | `createTurn` and `submitToolResult` stream `TurnEvent`s over Server-Sent Events |
| Leases | `acquireLease`, `renewLease`, `releaseLease`, `getLease` |
| Agents | `listAgents` (by space, status, page), `getAgentCard` (the agent's A2A card) |
| Spaces | `listSpaces` |
| A2A | `listA2ATasks` (by target agent, status, page) |

## Turns and tools

A turn streams `turn.started`, any number of `text.delta`, then `turn.completed` (or `turn.error`).
When the brain needs a tool it sends `tool.call` and completes with `stopReason: tool_call`; Desk runs
the tool and posts the result to `submitToolResult`, which streams the rest of the turn.

## Leases

Only the lease holder may send turns or tool results. A lease lasts `ttlSeconds` (5 to 3600) and is
renewed before `expiresAt`. Another Desk opening the session acquires with `takeover: true`: the old
lease ends at once, and the old holder's next write or renew fails with `lease_lost`, so it becomes
read-only. Without `takeover`, acquiring a held lease fails with `lease_held` and names the holder.
After `expiresAt` the lease is gone (`lease_expired`) and anyone may acquire.

## Agent directory

The agent operations mirror endue AI's own API so endue AI can serve them by renaming fields
(snake_case there, camelCase here). Lists are newest first and paged like endue AI's
`PaginatedList` (`items` and `pagination`).

| Here | endue AI |
| --- | --- |
| `Agent` | `AgentGetResponse` (`/platform/v1/agents`) |
| `AgentCard` | `A2ACardSummary` plus `A2ACard.enabled` |
| `A2ATask`, `A2ATaskStatus` | `A2ATask`, `A2ATaskStatus` (`progress` is a Desk addition) |
| `Space` | `UserSpaceGetResponse` (`/platform/v1/spaces`) |
| `listAgents?spaceId=` | agents that entered the space (`space.agent.entered`) |

Desk shows an agent as working while a task it was handed is `working`, and as waiting while the
agent is `inactive`. Archived agents are not shown.

## Rules

Component schemas use plain JSON Schema 2020-12 (no OpenAPI-only keywords) so one validator reads all
specs. `format` is documentation only. `just check` lints this file with spectral (`.spectral.yaml`).
`vectors/` is shared by the Rust and TypeScript contract tests.
