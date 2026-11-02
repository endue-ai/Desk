---
status: accepted
date: 2026-11-02
decision-makers: Team endue
---

# A theme is six layers of values in a plugin of kind theme

## Context and Problem Statement

ADR 0056 makes themes a core system with one active theme. People, agents and the brain will write
themes, the gallery will show them and a market will carry them, so their file format is a public,
persisted contract. A token map alone (what `contributes.themes` holds) can say colours, but a feeling
such as "warm paper" or "amber CRT" is also grain, typeface, corners, motion and what lies behind the
windows. What does a theme file hold, and how far may it go?

## Decision Drivers

* A sentence's feeling must be expressible: palette, material, type, shape, motion and backdrop
* Any valid theme must stay usable: readable, inside the layout's limits, without code
* The brain and people fill it in: few free numbers, named presets, defaults for everything
* Fonts and images travel with the theme; nothing loads from the network

## Considered Options

* A `theme` block in `plugin.json` of a new kind `theme`: six layers of bounded values and presets,
  assets by relative path, compiled by the runtime into `--desk-*` tokens
* Extend `contributes.themes` tokens with any `--desk-*` name and value
* A theme as a stylesheet that overrides the desk's CSS

## Decision Outcome

Chosen option: "a `theme` block in a plugin of kind `theme`", because it can say a whole feeling while
every value stays bounded, checkable and free of code, and it reuses plugin installation, serving and
validation.

* Shared layers: `type` (font stacks, `scale` 0.85–1.25, `tracking`, `.woff2` `fonts`), `shape`
  (`radius` none/subtle/soft/round, `density` compact/comfortable/spacious), `motion` (`personality`
  snappy/smooth/calm). Per scheme (`light`, `dark`): `colors` (token name to value, the shell's and
  Eris's tokens included), `contrast` (its high-contrast changes), `material` (`opacity` 0.6–1, `blur`
  0–24, `noise` 0–0.15, `border` 0–2, `shadow` none/soft/strong), `backdrop` (colour, gradient, image,
  fit, glow), `terminal` (sixteen ANSI colours).
* Values carry no `url()`, braces or semicolons; images enter only through `backdrop.image`. Assets are
  `.woff2`, `.png`, `.jpg` or `.webp` (no SVG), 2 MiB each, 8 MiB per theme, checked by `validate_dir`.
* A theme plugin runs nothing and is always on, like a library; `desk.theme.active` chooses.
* The runtime compiles layers into the tokens the design system already defines (and a few new ones:
  material, backdrop, ANSI), so the shell, `@endue-ai/ui` and plugins need only tokens.

### Consequences

* Good, because the brain, the editor and a person's hand all produce the same small, valid file
* Good, because presets let the runtime retune a preset later without breaking themes
* Bad, because a theme cannot express what its layers do not name (custom layouts, icon sets)
* Bad, because the main webview's CSP now loads fonts and images from the `desk-plugin` scheme

## More Information

`specs/plugin/v0/theme.schema.json`, `specs/plugin/v0/README.md` (Themes), `docs/ko/theme-requirements.md`
(TH-02, TH-03, TH-09, TH-10), ADR 0056.
