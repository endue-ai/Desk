# plugins/design-soft

`endue.design-soft`, "Soft". A `design-system` plugin (ADR 0090): no code, only the `designSystem`
block in `plugin.json`.

Pebbles: pill buttons with a soft tint for the main action, filled fields, pill tabs, raised cards and solid badges.

It names only what differs from the endue design system; every other component keeps the endue choice.
It works with any theme: the theme gives the colours and steps, this picks which of them each component
uses, so contrast stays the theme gate's.

Choose it in the design system studio, with `desk.design.use` (`{ "id": "endue.design-soft" }`), or
`desk.design.active: endue.design-soft` in `init.yaml`.

```bash
pnpm exec vitest run plugins/design-soft
cargo run -p desk-cli -- plugin validate plugins/design-soft
```
