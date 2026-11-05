# examples/brain-echo

The smallest implementation of `specs/brain/v0/openapi.yaml`: sessions, streamed turns (Server-Sent
Events), tool calls, session leases and a fixed agent directory. Node's standard library, in memory.

```bash
just brain-echo                                  # or: node examples/brain-echo/server.mjs
node examples/brain-echo/server.mjs --port 0     # a free port; the first line printed has the URL
```

It listens on `http://127.0.0.1:8787/v0`, which is where Desk looks by default (`DESK_BRAIN_URL`).

| Message | Answer |
| --- | --- |
| anything | the same text, one `text.delta` per word |
| `tool: <text>` | "Let me ask the echo tool.", a `tool.call` to `echo` with `{ "text": <text> }`, a stop at `tool_call`; after the result, "The echo tool said: <text>" |
| `tool <name> as <agent>: <json>` | the same for the tool `<name>` with the JSON object as arguments and `agentId: <agent>` (without `as <agent>`, no `agentId`); after the result, "The <name> tool said: <output>" or "failed: <output>" |
| several `tool ...` calls, one per line or joined by ` then ` | one turn that asks for each tool in order: after each result it says what the tool said and asks for the next |
| any, with `tools` | a `tool.call` to the tool `toolChoice` names, or to the first one offered it knows (`echo`, `propose_theme`), and a stop at `tool_call`; other tools get words |
| words that name an offered tool | Eris's tools (ADR 0084): a `tool.call` with `{}` to the tool whose name's words after the first are all in the message ("check my latest mail" calls `endue_mail_latest`); after the result, "The <name> tool said: <output>", the output's `text` when it has one |

`propose_theme` (`theme.mjs`) answers `{ name, description, theme }`, a valid theme block made from the
words in the message's last line, English or Korean: warm, amber, ocean, forest and pastel pick the
colours; night, paper, grain, glass and terminal the scheme, type, material, corners, motion and ANSI
colours (따뜻, 호박, 바다, 숲, 파스텔, 밤, 종이, 질감, 유리, 터미널 too). "따뜻한 종이 질감" is a light Warm
Paper, "amber terminal at night" a dark Amber Night Terminal.

Leases follow the contract: `lease_held` (with the holder) when another desk has the session,
`takeover` ends that lease at once and its holder then gets `lease_lost`, and a lease past `expiresAt`
gives `lease_expired`. Any bearer token is accepted.

The directory is fixed sample data. `GET /spaces`: Home and Studio. `GET /agents`: Mira, Theo and Juno
(inactive) in Home, Kai and Lena in Studio. `GET /agents/{agentId}/card`: each agent's A2A card. `GET
/a2a/tasks`: four hand-overs. Lists filter by `spaceId`, `targetAgentId` and `status`, come newest first,
and page with `page` (from 1) and `limit` (1 to 100, default 20); bad values are `invalid_request`.

`BRAIN_ECHO_DELAY_MS` (default 40) is the pause between streamed events, `BRAIN_ECHO_SECOND_MS` (default
1000) the real milliseconds in one lease second (the tests use 20).

`brain.mjs` is the state machine, `theme.mjs` propose_theme, `directory.mjs` the directory, `server.mjs`
the HTTP. Tests: `cargo test -p desk-brain --test conformance --test directory -p desk-core --test brain_ask`.
