---
status: accepted
date: 2026-10-28
decision-makers: Team endue
---

# The shell has a system layer that modes cannot change

## Context and Problem Statement

A mode lays out the desk: surfaces, Eris's place, whether the rail and the drawer show. If the mode
switcher itself were part of what a mode controls, a mode could move or hide the one control that
leads back out of it. Which parts of the shell belong to the desk rather than to a mode?

## Decision Drivers

* The way out of a mode must always be where the person left it
* Mode files describe a layout; they should not need to know about the shell's own controls
* Keep the word "core" for the Rust core (`desk-core`, ADR 0014)

## Considered Options

* A system layer: fixed parts outside every mode, drawn above the mode layer
* Mode layouts carry every part, with the switcher marked "required"
* No layers: every part is placed by z-index alone

## Decision Outcome

Chosen option: "a system layer". `packages/runtime/src/system/layer.ts` mounts the mode switcher (top
left), the desktop switcher (top right) and the agent bar (left) once, at fixed places, at `--z-system`
above the mode layer (Eris, rail, bottom edge, surfaces). `DesktopLayout` has no fields for them, so no
mode file can name them. Commands and key bindings (`system/commands.ts`, `system/keys.ts`) are system
services too: a mode cannot unbind the key that switches modes.

### Consequences

* Good, because switching modes, even to one that hides the rail, never moves the way back.
* Good, because mode files stay pure layout and stay small.
* Bad, because the system layer's parts are runtime code, not plugins (`docs/architecture.md`,
  principle 2). They can become built-in plugins later, flagged so that modes cannot disable them.

## More Information

`docs/ko/desk-structure.md` should describe the two layers in its modes section. Tests:
`packages/runtime/e2e/shell-system.spec.ts`.
