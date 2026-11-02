---
status: accepted
date: 2026-11-02
decision-makers: Team endue
---

# Themes are a core system of the main UI, and every UI is built on them

## Context and Problem Statement

Desk has design tokens (`@endue-ai/ui`, `docs/design-system.md`) and plugins contribute token sets
(`contributes.themes`), but there is no theme anyone can pick: every contribution of the scheme in force
layers over the last, so installing a plugin with a theme silently restyles the desk, and only light,
dark, contrast and motion can be switched. Plugins still hold 636 literal colours, fonts, sizes, radii
and durations, so a token change reaches them only partly. The product targets builders, who want to
pick a theme, tune it, describe one in a sentence and share it as a file. Where does the theme system
live, and what does it own?

## Decision Drivers

* A theme is the design system's values: it must reach the shell, `@endue-ai/ui`, `base.css` and every
  plugin page alike, or it is a half theme
* Picking, previewing and applying must be instant and safe (no reload, no code, no permission)
* Builders make, check, version and share themes as files
* The owner's decision (2026-11-02): the theme system is its own system at the level of the editor and
  gallery, part of the main UI, not a plugin

## Considered Options

* A core theme system in the runtime: one active theme chosen by a setting, themes as data packages
  (kind `theme`), the studio (gallery, editor, describe, market) in the shell
* A replaceable `desk.themes` UI plugin for the gallery and editor (rule 9), themes as policy plugins
* Keep layering every contribution, add only a picker for schemes

## Decision Outcome

Chosen option: "a core theme system in the runtime", because the theme decides how every UI looks,
so its selection, compilation and studio belong with the shell that applies it, while the themes
themselves stay data that anyone can write.

* Themes are plugins of a new kind `theme`: a `theme` block in `plugin.json` with six layers (palette,
  material, type, shape, motion, backdrop, plus terminal colours) and font and image assets; no code,
  no entry, no permissions. The design is `docs/ko/theme-requirements.md`.
* `desk.theme.active` names the theme in force; installing one does not apply it. `contributes.themes`
  of policy plugins keep layering underneath, as the shell's own tokens do.
* The runtime compiles the active theme into `--desk-*` tokens, passes them through one contrast
  gate, and applies them to the shell and every frame. The theme studio is a system window of the shell.
* Every UI reads colour, font, text size, radius and duration from tokens only. `scripts/ui-lint.mjs`
  enforces it in `just check` as a ratchet; a `theme: content` comment marks a file's own colours.

### Consequences

* Good, because one switch restyles everything, live, and a theme is a reviewable JSON file
* Good, because the lint makes conformance measurable and keeps it from regressing
* Bad, because the studio is not replaceable by a community plugin, an exception to rule 9
* Bad, because 25 plugins must move their literals to tokens before themes reach them whole

## More Information

`docs/ko/theme-requirements.md` (TH, TS, TP), `docs/design-system.md`, ADR 0017 (policies are data),
ADR 0022 (UI components are custom elements).
