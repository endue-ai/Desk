---
status: accepted
date: 2026-11-05
decision-makers: Team endue
---

# The desk chooses Eris's brain, and the local brain stands in offline

## Context and Problem Statement

The app wired one brain: an `HttpBrain` at `DESK_BRAIN_URL`, examples/brain-echo on localhost by
default. `desk-brain-local` (Ollama) was complete and used by nothing, and the shell's brain switcher
answered "not served yet". The roadmap's M1 asks that Eris still answers with the network off (killer
feature 8). Where does the choice live, who may change it, and what happens when the chosen brain cannot
be reached?

## Decision Drivers

* The person chooses, in the shell and in init.yaml, and a plugin cannot change it
* Offline is ordinary: a turn should be answered, not wait, when a brain on this machine can answer
* A local choice keeps the conversation on this machine: nothing falls back to the cloud
* No new bridge method or permission for what is a desk preference

## Considered Options

* A runtime setting (`desk`'s `brain.use` and `brain.model`) that the core reads every turn
* A new bridge method `brain.use` with a `brain:manage` permission and a file of its own
* An init.yaml section of its own (`brain:`), read at start only

## Decision Outcome

Chosen option: "a runtime setting", because settings already layer init.yaml under what the shell sets,
only the owner can set its own keys (so the runtime alone can switch), and nothing in specs/ but
brain.status's answer changes.

* `brain.use` is `endue` (default), `local` or `echo`; `brain.model` names the Ollama model (default
  `llama3.2`). init.yaml writes them as `desk.brain.use` and `desk.brain.model`. A value outside the three
  is ignored.
* The app wires all three: endue at `DESK_BRAIN_URL` (default `https://brain.endue.ai/v0`) with the
  endue ID token (ADR 0089), echo at `DESK_ECHO_URL` (default `http://127.0.0.1:8787/v0`), and
  `LocalBrain` at `DESK_OLLAMA_URL` (Ollama's default), one per model.
* When the chosen remote brain is unreachable and the local brain answers (Ollama's `/api/version`), the
  turn runs on the local brain. Eris says `FALLBACK_LINE` before the first such answer, and again only
  after the chosen brain answered once more. A refusal (`unauthorized`, `rate_limited`) is not a
  fallback. brain.ask follows the same rule.
* brain.status names the choice (`brain`) and marks a local brain standing in (`fallback: true`); every
  variant stays valid v0.
* Each brain keeps its own sessions (`brain.json`, `brain-echo.json`, `brain-local-<model>.json`); turn
  ids are shared, so they never repeat across brains.

### Consequences

* Good, because a desk with Ollama answers offline, and the person sees which brain is answering.
* Good, because switching needs no restart: the next turn reads the setting.
* Bad, because a switch does not carry the conversation over: each brain has its own sessions until
  memory (#467, #468) gives Eris one context.
* Bad, because `https://brain.endue.ai/v0` is an assumption, like ADR 0089's endue ID URL; a desk without
  `DESK_BRAIN_URL` is offline on endue (or on its local brain) until the service is served there.
* Neutral: `docs/ko/desk-requirements.md` still names one brain; the maintainers update that source.
