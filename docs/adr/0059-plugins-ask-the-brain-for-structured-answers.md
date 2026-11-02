---
status: accepted
date: 2026-11-02
decision-makers: Team endue
---

# Plugins ask the brain for structured answers

## Context and Problem Statement

Describing a theme in words (`docs/ko/theme-requirements.md`, TB-01 to TB-05) needs the brain to answer
with values the desk can check and apply, not prose: a theme block. `brain.say` cannot carry that. It
streams text into the desk's one shared conversation, which Eris and the person read, under a lease the
whole desk holds. How does a plugin or the runtime ask the brain one question and get structured values
back, without reading or writing that conversation and without trusting free text?

## Decision Drivers

* The answer is values with a schema, checked before anyone uses them
* An ask never reads, writes or blocks the person's conversation with Eris
* The same contract for endue AI, a local model and `examples/brain-echo`, so it runs without endue AI
* The core runs nothing the brain asks for on an ask's behalf
* A permission narrower than `brain:converse`

## Considered Options

* `brain.ask { prompt, tool }`: one session per ask with its own lease; the brain must call the
  caller's tool (`tools` and `toolChoice` on `createTurn`), and the call's arguments are the answer
* A JSON answer in text through `brain.say`, parsed by the caller
* A `responseFormat` (JSON Schema) on `createTurn`, with the answer streamed as JSON text

## Decision Outcome

Chosen option: "`brain.ask` with a tool", because tool calls are how every model family returns
arguments that follow a schema, the brain contract already carries `tool.call`, and a session per ask
keeps the shared conversation untouched.

* `createTurn` takes `tools` (`ToolDefinition`: `name`, `description`, `schema`) and `toolChoice`
  (`auto`, `required`, or `tool` with a name). A brain that does not know tools answers in text, and the
  caller reports that the brain gave no answer instead of guessing.
* `brain.ask` opens a session, acquires its own lease, sends the prompt with the caller's tool and
  `toolChoice: tool`, takes the first call of that tool, releases the lease and never posts a result.
  The session is not used again.
* `structured` rides on the completed `brain.turn`, addressed to the caller only, and only when the
  arguments match the tool's `schema`. The core compiles that schema against the desk's own specs
  (nothing is fetched) and refuses one that does not compile or does not describe an object.
* `brain:ask` is a permission of its own: it reaches no session of the desk's, and `brain:converse`
  does not cover it. The desk grants it to the runtime, whose theme studio asks.
* Offline, an ask behaves as `brain.say` does: the `offline` line, retries, `online`, then the answer.
* `desk-brain-local` maps `tools` to Ollama's function tools; Ollama has no tool choice, so a named
  or required choice becomes the offered tools and a system line that asks for the call.

### Consequences

* Good, because callers get values they can validate, and a theme block from words is a schema check
  away from the gate and the preview
* Good, because a slow or failed ask cannot hold or garble the person's conversation
* Good, because brain-echo answers `propose_theme` from words, so the flow is tested without endue AI
* Bad, because every ask is a new session on the brain, which keeps sessions nobody reopens
* Bad, because a brain that ignores `toolChoice` gives no answer at all rather than a partial one

## More Information

`specs/bridge/v0/brain.schema.json` (`BrainAskRequest`, `BrainTurnData.structured`),
`specs/plugin/v0/permission.schema.json` (`BrainAskPermission`), `specs/brain/v0/openapi.yaml`
(`ToolDefinition`, `ToolChoice`), `crates/desk-core/src/core_ask.rs`,
`crates/desk-brain-local/src/tools.rs`, `examples/brain-echo/theme.mjs`, ADR 0056, issue #305. The
studio's Describe tab and Eris's entry to it are #312; endue AI implements `tools` on its side.
`docs/architecture.md` and `docs/ko/desk-structure.md` should name `brain.ask` beside `brain.say` when
they are next updated (outside this change).
