# plugins/agents

`endue.agents`: every agent as a card in one interface (ADR 0112). The person's endue AI agents
(`studio.*`, ADR 0122) and the agent programs the core finds on this computer (`agents.*`, ADR 0110)
come out as one card with a source badge (endue or Local), a presence, a status line and the last
activity, laid out after the endue.ai web. On the public SDK and bridge only; autoload, off until
"Agents: Home" (`endue.agents.open`) opens it.

- **Home**: the card grid with source and status chips and search; the Activity tab, every
  conversation in Waiting · Active · Failed · Done with agent chips. Signed out, offline, a desk
  without `studio.*` and a refused permission each say so, and the local side keeps working.
- **Studio**: one agent's card with its facet cells and an inspector beside it. An endue agent:
  identity, prompt (revisions, restore), traits, skills, connectors, channels, status (Enable,
  Disable) and settings (visibility, chat model, Open in endue.ai, Delete with the name typed). A
  local agent: program, version, model, working folder, sessions, and a chat.
- **Chat with a local agent**: `agents.ask` (resuming a session with its `sessionId`), the reply
  built from `agents.run` steps as it streams, Stop (`agents.stop`), history (`agents.transcript`). A
  message that may change files waits for the person's yes (ADR 0099).
- **New agent**: Find an agent for me (`studio.catalog.list`, `.recommend`, `.use`) or Build from
  scratch (a name of 1–100 characters and a role); the new agent opens in Studio.

| Permission | Why |
| --- | --- |
| `studio:manage` | The endue agents, their facets, conversations and the catalog (`studio.*`) |
| `agents:manage` | The local agents, their sessions and runs; asked for when refused |
| `shell:open` (https) | Open in endue.ai, links in answers |
| `cmd:invoke` (`desk.account.sign-in`) | Sign in from the signed-out Home |

| File | Purpose |
| --- | --- |
| `ui/studio-api.js`, `local-api.js` | The only doors to `studio.*` and `agents.*`: names, shapes, errors |
| `ui/cards.js`, `home.js`, `studio.js`, `studio-endue.js`, `create.js` | Card, Home, Studio, New agent models |
| `ui/app.js`, `sides.js`, `studio-actions.js`, `local-chat.js` | Controller, reads, endue changes, chat |
| `ui/view*.js`, `dom.js`, `ask.js`, `*.css` | The DOM, `@endue-ai/ui` elements and kit classes, tokens only |

```bash
pnpm exec vitest run plugins/agents
just test-e2e packages/runtime/e2e/agents.spec.ts
cargo run -p desk-cli -- plugin validate plugins/agents
```
