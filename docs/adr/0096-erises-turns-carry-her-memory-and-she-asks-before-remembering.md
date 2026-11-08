---
status: accepted
date: 2026-11-05
decision-makers: Team endue
---

# Eris's turns carry her memory and working context, and she asks before she remembers

## Context and Problem Statement

ADR 0095 gave Eris a memory on this computer, but nothing used it: a turn sent the brain the person's
line and the offered tools only, nothing was kept after a turn, and Eris had no way to keep a fact.
The roadmap's M2 asks that she knows yesterday's work after a restart, on endue AI and on the local
brain alike, and that she asks before a fact is stored. What does a turn carry, what is kept after it,
and how does a fact get past the person?

## Decision Drivers

* The same shape for every brain: endue AI, the local brain and brain-echo read one contract
* Eris never keeps a fact the person did not see, unless the person said she may
* Reuse the permission engine and the approval card (ADR 0072, ADR 0078) instead of a new consent path
* A turn's context costs little: no embeddings, no extra brain call

## Considered Options

* The core sends a `TurnRequest.context` and keeps episodes itself; Eris remembers through a desk tool
  that ADR 0078's approval holds
* The brain asks for memory with tool calls (memory.search as a tool) and keeps its own episodes
* A remember setting (ask or freely) apart from grants

## Decision Outcome

Chosen option: "the core sends the context and keeps episodes; remembering is an approved call",
because it works the same on every brain without asking it for anything and needs no new consent
mechanism.

* `specs/brain/v0` `TurnRequest.context`: `facts` (up to 8: all facts while there are 8 or fewer,
  else those memory search finds for the line), `episodes` (the 3 newest) and `working` (the time, the
  plugins with surfaces that are on, the last 5 commands). Items in view stay with the runtime for now.
  The local brain reads it as one system message for that turn only; HttpBrain sends it in the JSON.
* After a brain.say turn that ends in words the core records an episode by `eris`: the line, her
  answer and the commands her errands ran. A failed or offline turn records none.
* Every turn on a desk with memory offers `desk-remember` (`{ text, tags? }`). Eris's call runs
  `memory.remember` as `agent:eris`: her first use asks for `memory:write` (ADR 0072), and each fact
  waits on the approval card (ADR 0078, action `memory.remember`, the fact as a `fact` preview) with
  Allow once, Allow for this task or Deny. An `always` grant of `memory:write` lets her remember freely.
* brain-echo calls `desk-remember` for "remember that …" so tests can script it.

### Consequences

* Good, because a restarted desk tells the brain yesterday's facts, and the local brain gets them too.
* Good, because the person sees each fact before it is kept, in the card they already know.
* Bad, because word search picks the facts: a line that shares no word with a fact misses it once
  there are more than eight.
* Bad, because the first remembered fact asks twice (the grant, then the card) unless the person
  answers the grant with Always.
* Neutral: ADR 0109's desk snapshot (the windows on screen, where they are, which has the focus)
  goes in the message's first part when the composer sends it; `working.surfaces` stays the plugins
  that can show a surface, so a line without the snapshot (the CLI, MCP) still carries them.
* Neutral: `docs/ko/` does not describe memory in turns yet; the maintainers add it.
