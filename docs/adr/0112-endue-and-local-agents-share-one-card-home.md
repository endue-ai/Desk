---
status: proposed
date: 2026-11-08
decision-makers: Team endue
---

# endue and local agents share one card Home, one Studio and one chat

## Context and Problem Statement

The person manages their endue AI agents on endue.ai: an Activity board of conversations on Home,
one agent's configuration canvas in Studio, and Create with Find an agent for me or Build from
scratch. On this computer the core now finds Claude Code and Codex and serves their sessions and runs
(`agents.*`, ADR 0110), and `studio.*` reaches the platform API for the endue agents (ADR 0122). The
person asked for the web's agent management as cards in the desk, and for the local agents in the
same interface, with messages sent and received. Where does that live, what is a "card" when the web
has no card grid for owned agents, and how do two very different sources look the same?

## Decision Drivers

* One interface: an agent is an agent, wherever it runs; the source is a badge, not a separate app
* Follow the web's layout (Activity columns, Studio's card with facet cells and an inspector, the two
  Create modes) so a person moving between endue.ai and the desk finds the same places
* Built-in features are plugins in the community format, on the public bridge only (AGENTS.md rule 9)
* The endue side degrades on its own: signed out, offline or a desk without `studio.*` never hides the
  local agents
* Nothing changes files without the person's yes (ADR 0099)

## Considered Options

* A new UI plugin, `endue.agents`, over `studio.*` and `agents.*`, with one card model for both
* Grow the shell's agent bar and the local agent screen (ADR 0110) into Home and Studio
* Grow `endue.local-agents` (ADR 0084) to also show endue agents

## Decision Outcome

Chosen option: "a new UI plugin", because it keeps the shell's composition roots untouched, uses only
the public bridge as any plugin would, and gives both sources one model instead of two screens.

* **One card model.** `cards.js` turns an endue agent (`StudioAgent` and its conversations) and a
  local agent (`LocalAgent`, its sessions and runs) into the same Card: name, role, handle, avatar,
  presence (working, needs you, online, paused, offline), status line, source badge, last activity,
  and one sort order (presence, then the most recent, then the name). The web has no card grid for
  owned agents; its only cards are the catalog's, so the Home's grid takes their shape.
* **Home** has two tabs: the cards with source and status chips and search, and the Activity board.
  Endue conversations sit in the column the core computed (`activity`); a local session is a
  conversation, Active while a run of it goes on and Failed when its last run failed.
* **Studio** is one agent's card with captioned facet cells and an inspector beside it. An endue
  agent's facets come from one `studio.agents.facets` read, and a facet endue AI did not answer for
  says so in its cell. A local agent gets the same card with its program, version, model, working
  folder and sessions, and its chat opens beside it. Delete needs the agent's name typed, as on the web.
* **Chat with local agents only.** `agents.ask` resumes a session by `sessionId`; the reply is built
  from `agents.run` steps, kept even when they arrive before `agents.ask` answers; Stop is
  `agents.stop`; history is `agents.transcript`. Read-only by default; "May change files" asks the
  person before each message, with the prompt and the folder shown.
* **Adapters.** `studio-api.js` and `local-api.js` are the only files that know method names and
  shapes; a rename in either namespace touches one file.
* **Permissions.** `studio:manage` (held as declared, a built-in), `agents:manage` (asked for with
  `perm.request` when refused), `shell:open` for https (Open in endue.ai, links in answers) and
  `cmd:invoke` for `desk.account.sign-in`.

### Consequences

* Good, because the person sees every agent in one grid and one board, and the local ones work with
  no endue account at all.
* Good, because the plugin is an example of a full UI plugin over two core namespaces, in the
  community format.
* Bad, because two places now show local agents: the shell's agent bar and screen (ADR 0110) and this
  Home; and three ask them: those two and `endue.local-agents` (ADR 0084).
* Bad, because the endue list carries no role or description; a card shows the role only once the
  agent's facets were read in Studio.
* Bad, because chatting with endue agents (runs over server-sent events) is not here yet: an endue
  conversation on the board opens on endue.ai.

### Follow-ups

* Chat with endue agents in the same chat panel, once the core streams their runs.
* Retire `endue.local-agents` (its chat and activity are covered here; its compare, board and agent
  tools are not), or fold its compare and board into this Home. Decide after this Home ships.
* Join the agent bar's local agent screen and this Studio, so one click from the rail opens the card.
* Edit skills, connectors, traits and channels in the inspector, not only read them.

## More Information

Issue #537. Code: `plugins/agents/`. Tests: `plugins/agents/tests/`,
`packages/runtime/e2e/agents.spec.ts`. Builds on ADR 0084, 0099, 0110 and 0122; the web's screens are
`pages/app/activity/ActivityPage.tsx`, `widgets/agentCanvas/` and `pages/create/CreateAgentPage.tsx`
in the endue.ai web.
