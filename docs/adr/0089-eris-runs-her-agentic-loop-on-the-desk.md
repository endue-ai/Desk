---
status: accepted
date: 2026-11-05
decision-makers: Team endue
---

Status: the endue ID bullet below is superseded by ADR 0111, under which the desk signs in at auth.endue.ai
through the platform's device flow.

# Eris runs her agentic loop on the desk, over plugin tools, signed in with endue ID

## Context and Problem Statement

A line typed to Eris ("check the newest mail in my inbox") went to the brain as text, and the brain
answered in words. ADR 0088 lets plugins offer agents their commands as tools, and every desk turn now
offers them. Still, a call on Eris's own conversation names no agent, so it ran `echo` only. The person
could not see a hand-off, nothing bounded a brain that kept calling tools, and `HttpBrain` sent no endue
ID token, so endue AI could not know who was asking. Who runs Eris's calls, how is each hand-off shown,
and where does the brain's credential come from?

## Decision Drivers

* The person sees where the line went: into Eris, out to a plugin, back to her, then her answer
* Any plugin, built-in or community, can offer Eris a tool in the same format (design rule 2)
* Calls run under the permission engine, the agent's allowlist and approvals (ADR 0072, 0078)
* Closed services stay outside: endue AI through `specs/brain`, endue ID through public standards
* The brain's token never reaches the runtime, a plugin or the bridge

## Considered Options

* The desk drives the loop: each brain.say turn offers plugin commands as tools, the core runs the
  brain's calls and sends the results back until the brain answers in words, and the turn reports
  every hand-off
* endue AI drives the loop alone (docs/ko/desk-requirements.md, agents) and Desk runs the bridge
  methods it is asked for, unseen
* The runtime drives it over brain.ask, one ask per step
* Desk calls a model API directly with a key the person pastes into settings

## Decision Outcome

Chosen option: "the desk drives the loop". The brain stays the model, with endue AI or a local
brain behind the same contract. The desk keeps what it already owns: tools, permissions and surfaces.

* **Tools are agent commands** (ADR 0088): `desk-tools`, `desk-run`, and every command marked `agent`
  by name when they fit in the turn's 32.
* **A call that names no agent is Eris's.** It runs as `agent:eris` when it is one of the desk's tools
  (`desk-tools`, `desk-run`, or a command), so grants, `agents.eris.allow`, prompts, approvals and
  the perm log apply. A bridge method without an agent still runs nothing. A turn runs at most
  `MAX_STEPS` (12) calls. Past that, it ends with `TOO_MANY_LINE`.
* **Every hand-off is a step.** brain.turn gains `tool` and `tool-result` with
  `{ callId, command, provider, title, ok }`.
* **The shell draws it.** A sent line flies into Eris's body wherever she floats. On `tool`, a spark
  labelled with the plugin leaves her and flies to that plugin's window, or waits beside her when the
  plugin has no window, and the window glows. On `tool-result`, the spark flies back and sinks into
  her. She speaks once every spark is home (`eris/errand.ts`).
* **endue ID signs in with the OAuth 2.0 device authorization grant** (RFC 8628) at `DESK_ID_URL`
  (default `https://id.endue.ai`, client `endue-desk`, endpoints `/oauth/device/code` and
  `/oauth/token`). account.* (`account:manage`, granted to the runtime only) starts it, opens the page
  and reports `account.changed`. The token is kept in `<data>/account.json` (mode 0600) until the OS
  keychain arrives (SYS-06), and it is refreshed when it expires. `HttpBrain` asks for it on every
  request (`with_token_source`) and now speaks https. A brain that answers `unauthorized` makes Eris
  say `SIGN_IN_LINE`.

### Consequences

* Good, because every agent command is one of Eris's tools as well. The Mail plugin's read-only
  `endue.mail.latest` is the first one made for her.
* Good, because endue AI needs no list of Desk's commands. A local brain gets the same tools.
* Good, because the person sees every hand-off and can refuse each tool at its first use.
* Bad, because every turn sends up to 32 tool definitions, which costs tokens (ADR 0088).
* Bad, because the first call of each tool asks the person once for `agent:eris`. Until a default
  allowlist is decided, that prompt is the price of running it.
* Bad, because the token sits in a plain file until the keychain, and because the endue ID URL and
  its endpoint paths are assumptions that endue ID must serve. The deep-link sign-in (SY-01,
  SYS-07) stays to do.
* Bad, because only the shell's Eris draws errands. `plugins/eris` does not yet (ADR 0027).

## More Information

Builds on ADR 0014, 0072, 0078 and 0088. Specs: `specs/bridge/v0/brain.schema.json` (`BrainTurnTool`)
and `specs/bridge/v0/account.schema.json`. Core: `agent_tools.rs` (Eris's calls and steps),
`conversation.rs`, `account.rs` and `core_account.rs`. Runtime: `eris/errand.ts`, `shell/Composer.ts`
and `system/endue-id.ts`. examples/brain-echo calls an offered command whose tool name's words are in
the line.
This supersedes the line on the loop in docs/ko/desk-requirements.md (agents: "the agentic loop is
in endue AI"). That line, and the endue AI row of docs/ko/desk-structure.md, should say that endue
AI's own agents loop there, while Eris loops on the desk.
