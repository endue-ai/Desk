---
name: design-ui
description: Build or change any UI of the desk (a plugin page, the shell, an @endue-ai/ui element, a theme or design system) on the endue design system of endue.ai/design, then run its checks. Use as /design-ui <path or issue>, and follow it whenever a change touches CSS, HTML or what a page draws.
argument-hint: <path or issue>
---

# design-ui

The argument names what you are changing: $ARGUMENTS. The desk's look is one system (ADR 0056, ADR 0090,
ADR 0265): theme tokens, then component tokens, then the kit and elements, then the page. A page that
stays inside it follows every theme, design system, scheme and contrast setting without a change.

## Before you start

1. Read `docs/design-system.md` whole: the principles, the screen check, the colour roles, the
   components and the page patterns. Its examples are what to copy.
2. Read the page's current CSS and HTML whole, and `examples/plugin-hello-ui` for the smallest page.

## Steps

1. **Sheets.** A plugin page links `/_desk/tokens.css` and `/_desk/base.css` (the kit and the patterns
   in `packages/ui/src/{base,patterns}.css`) and imports `@endue-ai/ui` for the elements. The shell uses
   `packages/runtime/src/shell/kit.css`.
2. **Controls are components.** Use the elements (`<desk-button>`, `<desk-input>`, `<desk-menu>` …) or
   the kit classes (`.desk-btn`, `.desk-field`, `.desk-tabs`/`.desk-tab`, `.desk-row`, `.desk-chip` …) on
   native controls. Pick the semantic variant and leave its look to the design system: one `primary` per
   group, `danger` for what destroys, `quiet` in toolbars, the default (outline) for the rest.
3. **Patterns before new CSS.** Header, hairline list, callout, filter chips, keycap, status dot, star,
   skeleton, spinner, empty state and error are in `patterns.css`. Write page CSS only for layout.
4. **Values are tokens.** Colour, font family, text size, radius and duration come from `--desk-*`
   tokens only; derive with `color-mix()` and `calc()` over them. Spacing sits on the 4px grid
   (`--desk-space-*`). A file's own colours carry a `theme: content` mark.
5. **The rules.** Selection is the hover surface, never `primary`. `--desk-star` is only on `.desk-star`,
   where an agent is at work; loading data is a spinner or skeleton. Status is a sentence first, then a
   badge or dot; a coloured surface only for a warning, a failure or what needs the person. Only
   floating things get a shadow. Links are underlined. Nothing moves on its own but the star.
6. **Words.** Sentence case; a button is a verb ("Save", "Reconnect"); a confirmation names the action,
   never "OK"; an error says what failed and how to fix it; a placeholder is an example, not the label;
   "endue" is lowercase.
7. **Something is missing.** A role, a component or an option the system lacks is a change to the
   system, not to the page: spec first (`specs/plugin/v0/design-system.schema.json` for a recipe
   option), then `packages/ui` (`tokens.ts`, `design/catalogue.ts`, `design/compile.ts`, the kit),
   `plugins/theme` and the built-in themes for a colour, `just codegen`, `just build-ui`, docs, and an
   ADR (`/add-adr`) when it is hard to reverse. Never a literal in the page instead.

## Checks

Run before every push and put the results in the PR body:

- `node scripts/ui-lint.mjs` and `node scripts/ds-lint.mjs`: no new literal, no native control without
  a kit class (the baselines only go down: `--update` after removing some).
- `pnpm exec vitest run packages/ui plugins/theme` and the touched plugin's tests (a plugin without a
  ui-lint baseline keeps a `tests/theme.test.ts`).
- The screen check of `docs/design-system.md` in dark and light, high contrast and reduced motion, and at
  360px wide. Browser checks run only through `just test-e2e` (for example
  `just test-e2e packages/runtime/e2e/design-system.spec.ts`), never `playwright test` directly.
