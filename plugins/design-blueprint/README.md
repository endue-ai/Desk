# plugins/design-blueprint

`endue.design-blueprint`, "Blueprint". A `design-system` plugin (ADR 0090): no code, only the `designSystem`
block in `plugin.json`.

A drafting table: square corners, semibold caps on buttons, outlined actions, underlined fields and tabs, a brand bar on the active row.

It names only what differs from the endue design system; every other component keeps the endue choice.
It works with any theme: the theme gives the colours and steps, this picks which of them each component
uses, so contrast stays the theme gate's.

Choose it in the design system studio, with `desk.design.use` (`{ "id": "endue.design-blueprint" }`), or
`desk.design.active: endue.design-blueprint` in `init.yaml`.

```bash
pnpm exec vitest run plugins/design-blueprint
cargo run -p desk-cli -- plugin validate plugins/design-blueprint
```
