---
status: accepted
date: 2026-10-27
decision-makers: Team endue
---

# The web runtime is plain TypeScript and DOM, without a UI framework

## Context and Problem Statement

The design picks "OS webview + React" for screens. The web runtime itself, though, is a compositor: it
creates sandboxed iframes, places them on a grid, routes keys and applies theme tokens. Should the
runtime be written in React too?

## Decision Drivers

* The runtime is the shell every plugin depends on; it should be small and fast to load
* Deterministic, framework-independent rendering for snapshot tests on an injected clock
* Plugins choose their own UI technology inside their iframes

## Considered Options

* Plain TypeScript and DOM for the runtime; React for UI components and plugins
* React for everything, the runtime included

## Decision Outcome

Chosen option: "plain TypeScript and DOM for the runtime", because the runtime manages a handful of
long-lived elements (the compositor, surfaces, the status line) and gains nothing from a virtual DOM,
while every kilobyte and every render pass is paid by every plugin. React remains the choice for
`packages/ui` components and for built-in plugins.

### Consequences

* Good, because the runtime is a few hundred lines with no runtime dependencies besides the bridge and
  the tokens, and its render tree is fully determined by CSS and the clock.
* Good, because plugins are free to use React, another framework, or none.
* Bad, because shared components cannot be dropped into the runtime chrome without a small adapter.

## More Information

`packages/runtime`. Design: `docs/ko/desk-structure.md`, "기술 스택 장단점" (stack trade-offs). Issue #8.
