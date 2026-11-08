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

A call names the agent that makes it (`agentId`). Desk runs it as the caller `agent:<agentId>`: `echo`,
or any bridge method by its name with the arguments as its params (`cmd.invoke` answers with the
command's result), or a command (ADR 0088). The agent's grants are its own and never reach past
`agents.<agentId>.allow` in init.yaml (ADR 0072). A call without `agentId` gets `echo` only.

## Desk's tools

Plugins mark the commands agents may use (`agent` in `contributes.commands`, ADR 0088). Once a desk has
any, each of its turns offers them in `tools`:

| Tool | Arguments | Runs |
| --- | --- | --- |
| `desk-tools` | `{ query?, limit? }` | the bridge's `cmd.tools`: every agent command with its tool name, args and result schemas, `readOnly`, `irreversible` and `granted` |
| `desk-run` | `{ command, args? }` | the command `command` names, with `args`, answering what its provider answers |
| `<tool name>` | the command's args | that command: its id with every dot an underscore (`endue_git_state`) |

The commands are offered by name only when all of them fit in the turn (30 besides the two); else the
brain finds them with `desk-tools`. A call by a command's tool name or its id works either way, and a
bridge method of the same name wins. Each runs `cmd.invoke` under the `cmd:invoke` scope of that one
command: the allowlist caps it, a first use asks the person, and a command its manifest marks
`irreversible` waits for the person's approval every time (ADR 0078). A turn of a desk without agent
commands offers no tools.

`createTurn` may offer `tools` for that turn (`ToolDefinition`: `name`, `description`, and `schema`, a
JSON Schema of the arguments whose type is object) and say with `toolChoice` whether the brain must call
one: `auto` (the default: a tool or text), `required` (one of them) or `tool` with its `name`. A
`toolChoice` without `tools`, or naming a tool the turn does not offer, is `invalid_request`. A brain that
does not know tools answers in text. Desk's `brain.ask` sends one tool with `toolChoice: tool` in a
session of its own and takes the `tool.call`'s arguments as the answer: it never posts a result, so that
turn stays at `tool_call` and the session is not used again.

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
