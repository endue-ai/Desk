---
status: accepted
date: 2026-11-04
decision-makers: Team endue
---

# Plugins offer agents their commands as tools

## Context and Problem Statement

An agent is a caller with grants of its own (ADR 0072) and may already call any bridge method, `cmd.invoke`
among them. In practice it could do little with the desk's plugins: a manifest command said only its id
and title, so an agent could not tell what `endue.git.status` does, what args it takes or what it answers;
the desk's brain turns offered no tools, so a brain that knows only offered tools (the local brain)
could call nothing; and docker, calendar and database each kept their own list of descriptions and
schemas and registered them again at run time. How does a plugin say which of its commands are for
agents, what they take and answer, and how does a brain find and run them?

## Decision Drivers

* Everything is a command (ADR 0017): no second API for agents beside the registry
* The plugin author says it once, in `plugin.json`, as data; run-time registration may say the same
* The permission engine, the allowlist, the prompt and approvals stay the one gate (ADR 0072, 0078)
* A brain turn offers at most 32 tools, and tool names take no dots (`specs/brain/v0`)
* A brain with no tools of its own (the local one) must still be able to discover and run them
* Reading data and acting are told apart, so a brain can read freely and act carefully

## Considered Options

* Agent fields on a command (`description`, `args`, `result`, `agent`, `readOnly`), `cmd.tools`, and the
  desk's turns offering `desk-tools`, `desk-run` and every agent command by name when they fit
* A separate `contributes.tools` section with its own handlers, beside commands
* Every command offered as a tool, without an `agent` flag
* Only `cmd.list` and `cmd.invoke`, leaving discovery to the brain

## Decision Outcome

Chosen option: "agent fields on a command", because a tool is a command with words and schemas: the
registry, the grants, undo and approvals already apply to it, and one flag keeps the palette's commands
out of an agent's way.

* **The manifest.** `contributes.commands[]` takes `description`, `args` (a JSON Schema the core checks
  every `cmd.invoke` against), `result` (a JSON Schema of the answer, documentation only), `agent` (offer
  it to agents; needs a description) and `readOnly` (answers data, changes nothing the person keeps;
  never with `irreversible`). `cmd.register` takes the same as `description`, `argsSchema`,
  `resultSchema`, `agent` and `readOnly`, and what a registration leaves out comes from the provider's
  manifest; `irreversible` stays the manifest's alone. `cmd.list` shows them all.
* **`cmd.tools`** lists the registered agent commands, each with its tool `name` (the id with every dot
  an underscore: ids hold no underscores, so the name gives the id back), schemas, `readOnly`,
  `irreversible`, provider and `granted`. It needs no scope: an agent sees the commands its allowlist could
  let it run, any other caller those its `cmd:invoke` grants cover. `desk cmd tools` prints it.
* **The turn's offer.** Once tools are routed, every desk turn offers `desk-tools` (answers `cmd.tools`)
  and `desk-run` (`{ command, args }`), and every agent command by name when all of them fit in the 32;
  else only the two. With no agent command the turn offers nothing, as before. The two names hold no
  underscore, so they are never a command's.
* **Running one.** A tool call naming a command (its tool name or its id) or `desk-run` runs
  `cmd.invoke` as `agent:<id>` under the `cmd:invoke` scope of that one command, waiting for the answer:
  the allowlist caps it, a first use asks the person for that command, an `irreversible` one waits for
  approval with its args shown. A bridge method of the same name wins.
* **A plugin's grant is not the agent's.** A command runs with its provider's grants, so a command that
  runs programs or sends what cannot be taken back is `irreversible`: `endue.terminal.run`,
  `endue.terminal.send`, `endue.docker.run`, Docker's removals, `endue.git.push` and `endue.git.discard`.
* **The local brain** may name the agent its model speaks for (`LocalBrainOptions::with_agent`), so its
  tool calls run as that agent; without one they run echo only, as before.

### Consequences

* Good, because a plugin becomes agent-ready by adding a few fields to its manifest, and the built-in
  plugins show how: git (`endue.git.state` and its operations), the terminal (`sessions`, `output`,
  `send`, `run`), docker, calendar, database and the desk's `desk.files.open` and `desk.buffers.list`.
* Good, because a brain that knows nothing of Desk finds every tool with `desk-tools` and runs it with
  `desk-run`, and a small model gets the commands themselves when they fit.
* Good, because docker's descriptions and every manifest's schemas reach agents, the palette and
  `desk describe` from one place.
* Bad, because `args` is checked for every caller: a schema that requires an arg breaks the palette's
  bare run of that command, so built-in commands require none and check in their handler.
* Bad, because past 30 agent commands a turn offers only the two desk tools: one more round trip.
* Bad, because the tool list names installed plugins to every agent, with or without grants: offering a
  tool is not granting it, and the allowlist hides what it caps.
* Bad, because `readOnly` and `irreversible` are the author's word, as `irreversible` was (ADR 0078).

## More Information

Specs: `specs/plugin/v0/contributes.schema.json` (`CommandContribution`), `specs/bridge/v0/cmd.schema.json`
(`CommandInfo`, `CmdRegisterParams`, `cmd.tools`, `CommandTool`). Code: `crates/desk-core/src/core_tools.rs`,
`agent_tools.rs`, `conversation.rs`; `packages/runtime/src/plugin-commands.ts` and `commands.ts`;
`packages/bridge/src/stub-tools.ts`; `ctx.commands.tools()` in the SDK; `crates/desk-brain-local`
(`with_agent`); `crates/desk-cli` (`cmd tools`). Builds on ADR 0017, 0072, 0077 and 0078. Requirements
CORE-14 and BR-02 in `docs/ko/desk-requirements.md`.
