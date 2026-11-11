---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Refines ADR 0057 (a theme's material layer) for the compositor desk (ADR 0149).

# A window shows nothing of the windows under it

## Context and Problem Statement

A theme's material (ADR 0057) may make windows translucent: `opacity` 0.6–1 with a `blur`. In the
browser desk, the shell's window was one element with `backdrop-filter`, so what lay behind it was
frosted. Since the compositor became the only desk (ADR 0149) each window is its own texture, drawn
over the windows under it; the window's fill is the `surface` token, and nothing blurs what is behind
it. Under Glass (72%) the text of a window underneath read sharp through a title bar ("No repository"
through the Terminal's edge, QA pass of 2026-11-11, #158 item 18); a theme whose card has alpha shows
even more. Lagoon in the market (94–96%) shows the same, fainter. How does the desk draw a theme that
asks for translucent windows while the compositor cannot blur?

## Decision Drivers

* No window may be hard to read because of the window under it, under any theme a person can install
* Themes are data that people, Eris and markets have already written: their files must keep validating
* The rule must reach the compositor's chrome and every page from one place

## Considered Options

* The runtime makes every window opaque when it resolves the look: a see-through surface or card
  becomes its colour over the theme's background, and the blur goes
* Raise Glass's opacity (and ask market authors to): the other translucent themes keep the defect
* Blur in the compositor, or show only the wallpaper through a window

## Decision Outcome

Chosen option: "the runtime makes every window opaque", because it is one rule in `resolveTheme`
(`packages/runtime/src/theme.ts`) that the compositor's token table, the shell and every frame already
read, and no theme file changes.

* When the resolved `surface` (or, without one, the card) has an alpha below 1, `surface` becomes that
  colour painted over `background`: Glass's dark window is `#141a2e` at 72% over `#0b1020`, `#11172a`.
  `surfaceFilter` is removed. `surfaceOpacity` and the theme's `material` stay as written.
* A theme whose windows are opaque resolves exactly as before.

### Consequences

* Good, because a window under another never shows through it, whatever a theme asks
* Good, because a translucent theme still tints its windows toward its background, as it looked over
  a bare desk
* Bad, because Glass and Lagoon lose the frosted look they describe; the studio's opacity slider tints
  rather than shows through until the compositor blurs
* Neutral, because a compositor that blurs, or that shows only the wallpaper through a window, can
  drop this rule in one place

## More Information

Code: `packages/runtime/src/theme.ts` (`opaqueWindows`). Tests: `packages/runtime/src/theme.test.ts`
("a window shows nothing of the windows under it"), `plugins/theme-glass/tests/theme.test.ts`.
`docs/design-system.md` (Material) says it. No section of `docs/ko/desk-structure.md` changes.
