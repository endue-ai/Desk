---
status: accepted
date: 2026-11-09
decision-makers: Team endue
---

# endue agents and spaces open as windows whose card turns over to Studio

## Context and Problem Statement

Signed in to endue ID (ADR 0111), the person wants the desk's agent bar to hold the agents and spaces
they already have on endue.ai. Choosing one should open it as a window, as the local agents do (ADR
0110). Studio should turn the card over to show the agent's or the space's status. The look should
follow endue.ai's agent card and space list, and work like the desk. The agent bar read its agents
and spaces from the agent directory of `specs/brain/v0`, which endue AI does not serve, so after sign-in it stayed
empty. `studio.*` (ADR 0122) reached agents but no spaces. And endue.ai's spaces API also carries
people's ids, room members, attention reasons, billing and internal fields that an open-source client
must not take in.

## Decision Drivers

* The person's real agents and spaces, from the same server as endue.ai, once signed in
* A window per agent and per space, opened from the agent bar like every other screen of the desk
* The card first, the status one turn away, with keyboard, screen reader and reduced motion handled
* Nothing sensitive crosses into the repository or the bridge: only public gateway paths, only the
  fields a card shows, no person's id, no member list, no billing, no remote picture
* Signed out, the desk behaves as before

## Considered Options

* Spaces as `studio.spaces.*` over `specs/platform/v0`, and the shell's agent bar reading `studio.*`
  once signed in, each agent and space a host view (`endue-agent:<id>`, `endue-space:<id>`)
* Spaces in `specs/brain/v0` (`listSpaces` exists there), asking endue AI to serve the brain contract
* Open the `endue.agents` plugin's Studio for each agent: one plugin frame cannot be several windows

## Decision Outcome

Chosen option: "`studio.spaces.*` and host views". endue AI serves this API today, the token stays in
the core, and the views live in the window manager the desk already has.

* **Contract.** `specs/platform/v0` gains four read-only paths that endue.ai's own Spaces page calls:
  `GET /api/v1/spaces?include=summary`, `/spaces/{id}`, `/spaces/{id}/overview` and
  `/spaces/{id}/rooms`. The contract names only what Desk reads. A room's members, the viewer's
  capabilities and attention items are not named, and the tolerant readers drop them.
* **Bridge.** `studio.spaces.list` (the active spaces or the archived ones, most recently active
  first) and `studio.spaces.get` (the space with its counts, the agents taking part with the front
  agent first, five pieces of work going on and five results, its open rooms, and `problems` for a
  part that did not answer). Both are under `studio:manage`. The core passes a colour only as
  `#rrggbb` and an id only in the bridge's pattern, and it drops deleted spaces, agents that left and
  work in a status it has no word for.
* **Agent bar.** Signed in, the endue half replaces the directory's agents and spaces. Its agents come
  working first, then waiting for the person, then online, then disabled. A space shows its glyph
  on its colour. Signing in or out reads again. Signed out, or on a host without `studio.*`, the
  bar shows the directory as before.
* **Windows.** Choosing an agent or a space opens `endue-agent:<id>` or `endue-space:<id>` through
  `openView`: into the focused launcher pane, onto the pane that already shows it, or as a new window.
  The front is endue.ai's card: an agent's name, handle, role, presence, description, skills and
  model; a space's look, goal, front desk, agents, what is open and its newest result. The person's
  own agents in a space open their window from its Studio list.
* **Studio turns the card.** Both faces share one place, and Studio turns the card 180° on its
  vertical axis with `--motion-slow`, which is zero with reduced motion. The face away from the
  person is `inert` and `aria-hidden`, and the focus follows the turn. The back lists the status as
  facts. For an agent: status, presence, chat model, visibility, prompt revision, skills, connectors,
  traits, languages, conversations by board column, last activity and dates. For a space: status,
  counts, agents, rooms, then lists of the work, the results and the rooms. Which cards are turned
  is kept for the session, not across a relaunch.
* **Links.** "Open in endue.ai" opens `https://endue.ai/agent/<id>/studio` or
  `https://endue.ai/spaces/<id>`, the id encoded as one path segment. The runtime now holds
  `shell:open` for https, and its studio bridge refuses any URL off endue.ai.

### Consequences

* Good, because after sign-in the desk shows the same agents and spaces as endue.ai, and each one is
  a window that can be tiled, cascaded and spread like any other (ADR 0116).
* Good, because the bridge carries nothing about other people: no member, no person's id, no
  attention reason, no billing.
* Bad, because three places now show endue agents: this bar and its windows, the `endue.agents`
  plugin (ADR 0112), and endue.ai. The windows only read; changes still go through the plugin or the web.
* Bad, because presence comes from the 50 most recently active conversations, read when the bar
  loads. It is not live until the core streams endue's runs.
* Bad, because the contract follows more of a closed service: when its spaces API changes, the
  contract and the client follow by hand.

## More Information

Spec: `specs/platform/v0/openapi.yaml` (tag `spaces`), `specs/bridge/v0/studio-spaces.schema.json`.
Client: `crates/desk-platform/src/spaces.rs`, `wire_spaces.rs`. Core: `crates/desk-core/src/studio/spaces.rs`.
Runtime: `packages/runtime/src/system/endue.ts`, `shell/SideBarEndue.ts`, `surface/endue/`. App:
`apps/desk/src/shell-studio.ts` and the runtime's grants in `apps/desk/src-tauri/src/lib.rs`.
Builds on ADR 0110, 0111, 0112, 0116 and 0122.
