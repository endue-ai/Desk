# Desk brain API v0

`openapi.yaml` (OpenAPI 3.1) is the contract between Desk and a brain. The local brain adapter, endue AI
and `examples/brain-echo` implement it; `crates/desk-brain-*` are its clients.

| Area | Operations |
| --- | --- |
| Sessions | `createSession`, `getSession` |
| Turns | `createTurn` and `submitToolResult` stream `TurnEvent`s over Server-Sent Events |
| Leases | `acquireLease`, `renewLease`, `releaseLease`, `getLease` |

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

## Rules

Component schemas use plain JSON Schema 2020-12 (no OpenAPI-only keywords) so one validator reads all
specs. `format` is documentation only. `just check` lints this file with spectral (`.spectral.yaml`).
`vectors/` is shared by the Rust and TypeScript contract tests.
