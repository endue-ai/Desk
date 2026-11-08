---
status: accepted
date: 2026-10-28
decision-makers: Team endue
---

# The shell has a system layer that profiles cannot change

## Context and Problem Statement

A profile lays out the desk: surfaces, Eris's place, whether the rail and the drawer show (the shell's
part of a desk.profiles profile, `desk.shell.mode`; ADR 0025). If the profile switcher itself were part
of what a profile controls, a profile could move or hide the one control that leads back out of it.
Which parts of the shell belong to the desk rather than to a profile?

## Decision Drivers

* The way out of a profile must always be where the person left it
* A profile's layout should not need to know about the shell's own controls
* Keep the word "core" for the Rust core (`desk-core`, ADR 0014)

## Considered Options

* A system layer: fixed parts outside every profile, drawn above the mode layer
* Profile layouts carry every part, with the switcher marked "required"
* No layers: every part is placed by z-index alone

## Decision Outcome

Chosen option: "a system layer". `packages/runtime/src/system/layer.ts` mounts the profile switcher
(top left), the desktop switcher (top right) and the agent bar (left) once, at fixed places, at
`--z-system` above the mode layer (Eris, rail, bottom edge, surfaces). `DesktopLayout` has no fields for
them, so no profile can name them. Commands and keys are the runtime's (ADR 0017): desk.profiles never
turns off desk.profiles, desk.palette or desk.keys, so a profile cannot take away the key that switches
profiles.

### Consequences

* Good, because switching profiles, even to one that hides the rail, never moves the way back.
* Good, because a profile's layout stays pure layout and stays small.
* Bad, because the system layer's parts are runtime code, not plugins (`docs/architecture.md`,
  principle 2). They can become built-in plugins later, flagged so that profiles cannot disable them.

## More Information

`docs/ko/desk-structure.md` should describe the two layers in its profiles section. Tests:
`packages/runtime/e2e/shell-system.spec.ts`.
