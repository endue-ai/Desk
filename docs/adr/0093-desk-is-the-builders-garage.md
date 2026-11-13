---
status: accepted
date: 2026-11-05
decision-makers: Team endue
---

Status: amended by ADR 0205 (after ADR 0203): the mission stays; the milestones follow #232: windows
that pop out to the OS and back, the island, a resident hub and a compositor at an OS's quality, with
endue as the OS on Linux last.

# Desk is the builder's garage: a daily workshop that Eris runs and views show

## Context and Problem Statement

Ten days and 214 pull requests in, Desk has a small core, 46 plugins, three view languages, a theme
market, an agentic loop on its way in and no release. The requirements (`docs/ko/desk-requirements.md`)
say what the skeleton must have; nothing says what Desk is *for*, so every lane chooses its own priority.
The owner set eight goals on 2026-11-05 (`docs/ko/desk-roadmap.md`): a daily app for builders, Eris as
the orchestrating secretary with her own local memory, user-made and installable views as the core value,
a control center for many agents, a design system the person owns, and a helper that keeps the quality
of what builders make at its best. What is Desk, and which goal wins when two collide?

## Decision Drivers

* One sentence that every plugin, ADR and issue can be checked against
* Builders must open it every day before any feature matters
* The user's freedom (views, layout, design system) is the product, not a setting
* Eris must be a secretary, not a chat box: remember, propose, ask, coordinate
* Agents need hands and a single screen, inside grants (ADR 0072 · 0078)

## Considered Options

* An agent chat app: Eris in front, plugins behind her, the screen fixed around the conversation
* An IDE or a file manager with agents added: the files in front, Eris a side panel
* The builder's garage: the builder in the middle, Eris running the room, agents as hands, every wall a
  view the builder shaped, and the room itself open and stable every day

## Decision Outcome

Chosen option: "the builder's garage", because it is the only one in which the eight goals do not
compete. Desk is the garage a builder opens every day. Eris runs the garage, agents are the hands, and
everything shows in the view the builder wants. Desk's role is the helper's: a stable environment to
build in, freedom to shape it, and the quality of what is built kept at its best.

Five rules follow, and `docs/ko/desk-roadmap.md` orders the work by them.

* **The builder in the middle.** The middle of the screen is the person's; Eris and agents stand at the
  edges, as the first run already stages it.
* **The secretary rule.** Eris remembers, proposes and asks. Her memory lives on this computer in files;
  an endue account later carries it to other computers, and sync is not in scope before that step.
* **The hologram rule.** Data is organised once (items, the index, ADR 0032 · 0033) and drawn in any
  shape (universal views, ADR 0087). A view is data, so a person, Eris and the market make the same thing.
* **The robot-arm rule.** Agents are callers with their own grants (ADR 0072); anything hard to undo
  waits for approval (ADR 0078); every agent and result is on one screen.
* **The garage rule.** Releases, updates and gates are part of the product. Stability and quality are
  never traded for a feature.

When two goals collide the order is: opens every day (G1 · G8) → Eris remembers and delegates (G2 ·
G3) → views the person owns (G4 · G7) → the control center (G6). The roadmap's milestones M1 to M4 are
that order.

### Consequences

* Good, because a plugin, a view, an agent integration or a shell change can be judged by one question:
  does it keep the builder in the middle, Eris as the secretary, and the work in a view the builder can
  reshape?
* Good, because "views are data" (ADR 0032 · 0087) is confirmed as the product's core, so the view
  languages converge instead of growing, and the market generalises the theme market (ADR 0060).
* Good, because the first release stops being a side task: M1 is nothing but a desk that installs,
  starts and answers, and the quality track never ends.
* Bad, because an agent-chat product would have shipped sooner; the garage needs memory, a registry and
  a market before Eris looks complete.
* Bad, because "no fixed screens" costs more test surface than a fixed UI: every edge, including the
  shell's, must become a plugin (ADR 0026 · 0028) to keep the promise.
* Bad, because memory on this computer only, until M5, means a second computer starts from nothing.

## More Information

Design: `docs/ko/desk-roadmap.md` (source), `docs/roadmap.md` (English), the "Why Desk" section of
`README.md`. The goals build on the seven promises in `docs/ko/desk-requirements.md` and the principles
in `docs/ko/desk-structure.md`. Related ADRs: 0014 (the core holds the conversation), 0027 (one Eris),
0032 · 0033 · 0087 (items, index, universal views), 0060 (the theme market), 0072 · 0078 (agents as
callers, approvals), 0084 · 0086 · 0088 (local agents, MCP, commands as tools). This page is numbered
past the ADRs in open pull requests #457 (0089), #462 and #465 (0090 to 0092 once renumbered).
