---
status: accepted
date: 2026-11-17
decision-makers: Team endue
---

Extends ADR 0056 (themes), ADR 0057 (a theme's layers) and ADR 0090 (design systems).

# The endue look follows endue.ai/design: Ink and Stone, one ink fill, and the star

## Context and Problem Statement

The desk's default theme and design system were drawn from an earlier endue web design: a lavender
brand fill on every main action, ring and selected tab, and violet-tinted neutrals. endue.ai/design now
publishes the endue design system every product shares: two themes, Ink (light) and Stone (dark); the
fill is ink and there is one per group; selection is a surface, never a fill; the one colour belongs to
the star, which marks an agent at work; status is a sentence; only floating things get a surface. The
owner asked (2026-11-17) that the desk take that system's colours and patterns, and that the design
system keep later UI and plugin work consistent with it. What changes, and where?

## Decision Drivers

* One endue look across products: the same role values, the same patterns, the same rules
* Everything goes through the theme and design-system pipeline, so other themes and design systems
  keep working and every page follows without its own change
* The contrast gate stays the authority: no value lands that fails a pair the desk checks
* Plugins and agents need named patterns and a short rulebook, not a description of a look

## Considered Options

* Retune the endue theme and design system, add the few tokens and kit patterns the site's rules need,
  and write the rules into `docs/design-system.md` and an agent procedure
* A new theme and design system beside the old ones, the old staying the default
* Copy the site's `tokens.css` and `components.css` into the desk

## Decision Outcome

Chosen option: "retune the endue theme and design system", because the endue defaults are the desk's
identity and every theme and recipe already layers over them, and the site's class names and React
components do not match the desk's custom elements and kit classes.

* **Palette.** `colors` and `plugins/theme` take Stone and Ink. `primary` is ink (paper in the dark),
  `primarySoft` the hover surface, `primaryBorder` the border. New role tokens: `star` (the one
  colour; the gate holds it 3:1 on background and card), `chart9` and `chart10`, and code tokens
  (`codeSurface`, `codeComment`, `codeKeyword`, …). The site's oklch values are written as the sRGB hex
  a browser shows. Light status fills keep the site's `*-text` colours, as before: the desk reads a fill
  as text on a card (4.5:1), which the site's vivid light fills do not reach; the shell keeps those
  as `*Fill` for dots.
* **Recipe.** Tabs gain the option `segment` (a sunken track whose selected item is raised on the
  popover surface), now the default; cards take radius-lg; dialogs pad 16px on the card surface;
  tooltips take shadow-md; outline buttons sit on a hairline; fields are sunken and focus turns the
  border into a 2px ring; soft badges lose their border; ghost icon buttons are muted.
* **Patterns.** `packages/ui/src/patterns.css`, joined into `/_desk/base.css`, holds the page header,
  hairline lists, callouts, filter chips, keycaps, status dots, the star, skeletons and spinners. Links
  underline; headings are medium and tight. The island's agents at work twinkle as stars.
* **Rules.** `docs/design-system.md` carries the principles and the screen check; the procedure
  `design-ui` (`.claude/skills/design-ui/SKILL.md`) has agents follow them for every UI change.

### Consequences

* Good, because the desk and endue's other products read as one, and a page that uses tokens and the
  kit follows without a change
* Good, because the star gives agent work one mark, and selection and the main action stop competing
* Bad, because every page changes look at once; pages that used `primary` as a decoration turn ink
  and need a look, and lavender stays only where a page draws it from data or from `star`
* Bad, because two of the site's light chart colours (chart2, chart3) stand under 3:1 on white: they
  colour areas, not thin lines, so the Docker memory series moved to chart6
* Bad, because the star is a four-point placeholder: the logo's star is not in `brand/`

## More Information

https://endue.ai/design (tokens, components, writing, usage, themes); `docs/design-system.md`;
`packages/ui/src/{tokens.ts,patterns.css}`, `packages/ui/src/design/{catalogue,compile}.ts`,
`plugins/theme/plugin.json`, `specs/plugin/v0/design-system.schema.json` (DesignTabsStyle). No section
of `docs/ko/desk-structure.md` changes; `docs/architecture.md` names no colours.
