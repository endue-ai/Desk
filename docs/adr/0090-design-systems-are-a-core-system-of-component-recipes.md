---
status: accepted
date: 2026-11-05
decision-makers: Team endue
---

# Design systems are a core system of component recipes over theme values

## Context and Problem Statement

Themes (ADR 0056, ADR 0057) set what the `--desk-*` tokens hold: colours, material, type, the radius and
control-height steps, motion and backdrop. What a component is made of is fixed in code: every button has
`radius-md`, the main action is always a solid fill, a field is always a bordered box, a selected row is
always a fill. The shell, `@endue-ai/ui` and each plugin also draw their controls three different ways
(`.btn` in the shell, `<desk-button>` in frames, about 250 native controls with their own CSS in plugins),
so even a token change reaches them unevenly. The owner asked (2026-11-05) that every element of the UI be
a component of the design system, that people change the design system themselves or through Eris, and
that design systems, like themes, come several at a time, export, import and travel between people.
Where does a design system live, what does it hold, and how do components follow it?

## Decision Drivers

* A design system is chosen apart from a theme: any theme with any design system
* It must reach the shell, `@endue-ai/ui` and every plugin page alike, live, without reload
* People, Eris and the brain fill it in, so its values are few, named and bounded, with defaults
* No combination of a theme and a design system may break the contrast the theme gate guarantees
* It is data: no code, no CSS injection, no permission

## Considered Options

* A core system of component recipes: a plugin of kind `design-system` whose `designSystem` block picks,
  per component, named options; the runtime compiles them into component tokens over the theme's tokens
* A seventh theme layer `components`
* A design system as a stylesheet that overrides the desk's CSS

## Decision Outcome

Chosen option: "a core system of component recipes", because it separates what components are made of
from the values they are made with, so both can be chosen, shared and tuned on their own while every
value stays bounded and checkable.

* **The catalogue.** Fifteen components (button, icon button, field, check, tabs, card, row, menu, dialog,
  toast, badge, tooltip, table, progress, focus), each with a few properties of named options and a
  default; the defaults are the endue design system, today's look. `@endue-ai/ui/design` holds the
  catalogue; `specs/plugin/v0/design-system.schema.json` is the contract; a test keeps them equal.
* **Component tokens.** `compileDesignSystem` turns a recipe into `--desk-<component>-<part>` tokens whose
  values are references to theme tokens (`var(--desk-radius-full)`, `var(--desk-primary-soft)`) or bounded
  constants (a font weight, `uppercase`, a border width). Colour pairs come only from the role pairs the
  theme gate checks, so contrast holds under every theme.
* **One component, three bindings.** The shell's kit classes, the `@endue-ai/ui` elements and new kit
  classes in `base.css` (`.desk-btn`, `.desk-field`, `.desk-tabs`, `.desk-card`, `.desk-row` …) read the
  same component tokens. Buttons take semantic variants (default, `primary`, `danger`, `quiet`); the
  design system decides their look.
* **Selection.** `desk.design.active` names the design system in force (empty for endue). The runtime
  resolves the theme, then lays the active design system's component tokens over it, and sends both to
  the shell and every frame as it does tokens today. The default component tokens are in `tokens.css`.
* **The studio** is a system window of the shell beside the theme studio: gallery with live specimens,
  editor, import and export, market and Describe. Its commands carry agent fields (ADR 0088), so Eris
  lists, reads, chooses and changes design systems with the commands people use.
* **Conformance.** `scripts/ds-lint.mjs` counts native controls without a kit class per target, as a
  ratchet in `just check`, as `ui-lint` does for literals.

### Consequences

* Good, because one switch restyles every control the same way, and a design system is a small,
  reviewable JSON file the brain can write
* Good, because themes and design systems multiply: n themes × m design systems with no extra work
* Good, because the ratchet makes "every element is a design system component" measurable
* Bad, because a recipe cannot say what its catalogue does not name (a new component needs a catalogue
  and spec change)
* Bad, because plugins must move their native controls to the kit before design systems reach them whole
* Bad, because the studio is part of the shell, an exception to rule 9, as the theme studio is

## More Information

`docs/ko/design-system-requirements.md`, `docs/design-system.md`, ADR 0056, ADR 0057, ADR 0088, ADR 0091.
