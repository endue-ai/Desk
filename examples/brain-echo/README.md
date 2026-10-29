# examples/brain-echo

The smallest implementation of `specs/brain/v0/openapi.yaml`: sessions, streamed turns (Server-Sent
Events), one tool round trip, session leases and a fixed agent directory. Node's standard library only,
state in memory.

```bash
just brain-echo                                  # or: node examples/brain-echo/server.mjs
node examples/brain-echo/server.mjs --port 0     # a free port; the first line printed has the URL
```

It listens on `http://127.0.0.1:8787/v0`, which is where Desk looks by default (`DESK_BRAIN_URL`).

| Message | Answer |
| --- | --- |
| anything | the same text, one `text.delta` per word |
| `tool: <text>` | "Let me ask the echo tool.", a `tool.call` to `echo` with `{ "text": <text> }`, a stop at `tool_call`; after the result, "The echo tool said: <text>" |

Leases follow the contract: `lease_held` (with the holder) when another desk has the session,
`takeover` ends that lease at once and its holder then gets `lease_lost`, and a lease past `expiresAt`
gives `lease_expired`. Any bearer token is accepted.

The directory is sample data with fixed timestamps, so its answers never change. `GET /spaces`: Home and
Studio. `GET /agents`: Mira, Theo and Juno (inactive) in Home, Kai and Lena in Studio; `spaceId` and
`status` filter. `GET /agents/{agentId}/card`: each agent's A2A card. `GET /a2a/tasks`: four hand-overs;
`targetAgentId` and `status` filter. Lists come newest first, one page at a time: `page` from 1, `limit`
1 to 100 (default 20). A bad `page`, `limit` or `status` is `invalid_request`; an unknown agent's card is
`not_found`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `BRAIN_ECHO_DELAY_MS` | 40 | pause between streamed events |
| `BRAIN_ECHO_SECOND_MS` | 1000 | real milliseconds in one lease second (the tests use 20) |

`brain.mjs` holds the state machine and `directory.mjs` the directory; `server.mjs` carries both over
HTTP. Conformance: `cargo test -p desk-brain --test conformance --test directory`.
