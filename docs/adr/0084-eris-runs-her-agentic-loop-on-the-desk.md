---
status: accepted
date: 2026-11-05
decision-makers: Team endue
---

# Eris runs her agentic loop on the desk, over plugin tools, signed in with endue ID

## Context and Problem Statement

A line typed to Eris ("check the newest mail in my inbox") went to the brain as text, and the brain
answered in words. Two things were missing. Eris could not act through the desk's plugins on her own,
and the person could not see what she did. The brain contract already streams `tool.call` and takes
`submitToolResult` (ADR 0014, 0072), but brain.say offered no tools. Desk ran only the tools an agent
named by bridge method, and `HttpBrain` sent no endue ID token, so endue AI could not know who was asking.
Where does Eris's loop run, how does she find the plugin that can answer, how is each hand-off shown,
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

* **Tools are commands.** A command in `contributes.commands` with `tool` (`description`, and `args`
  as JSON Schema) is offered to the brain on every turn. The core reads the provider's manifest, as it
  does for `irreversible`. The tool name is the command id with its dots as underscores
  (`endue.mail.latest` → `endue_mail_latest`). This is reversible, because command ids hold no
  underscore. At most 32 tools are offered.
* **Calls run as `agent:eris`** (or as the agent the call names) through cmd.invoke, so grants, the
  allowlist, prompts, approvals and the perm log apply. The command's answer is the tool's output.
  A turn runs at most `MAX_STEPS` (12) calls. Past that, it ends with `TOO_MANY_LINE`.
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

* Good, because a plugin becomes one of Eris's tools by adding one manifest field, and the Mail
  plugin's `endue.mail.latest` is the first.
* Good, because endue AI needs no list of Desk's commands. A local brain gets the same tools.
* Good, because the person sees every hand-off and can refuse each tool at its first use.
* Bad, because every turn sends up to 32 tool definitions, which costs tokens. A ranking of tools by
  the line can come later.
* Bad, because the first call of each tool asks the person once for `agent:eris`. Until a default
  allowlist is decided, that prompt is the price of running it.
* Bad, because the token sits in a plain file until the keychain, and because the endue ID URL and
  its endpoint paths are assumptions that endue ID must serve. The deep-link sign-in (SY-01,
  SYS-07) stays to do.
* Bad, because only the shell's Eris draws errands. `plugins/eris` does not yet (ADR 0027).

## More Information

Specs: `specs/plugin/v0/contributes.schema.json` (`CommandTool`), `specs/bridge/v0/brain.schema.json`
(`BrainTurnTool`) and `specs/bridge/v0/account.schema.json`. Core: `eris_tools.rs`,
`conversation.rs`, `account.rs` and `core_account.rs`. Runtime: `eris/errand.ts`, `shell/Composer.ts`
and `system/endue-id.ts`. examples/brain-echo calls an offered tool whose name's words are in the line.
This supersedes the line on the loop in docs/ko/desk-requirements.md (agents: "the agentic loop is
in endue AI"). That line, and the endue AI row of docs/ko/desk-structure.md, should say that endue
AI's own agents loop there, while Eris loops on the desk.
