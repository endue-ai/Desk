# plugins/design-compact

`endue.design-compact`, "Compact". A `design-system` plugin (ADR 0090): no code, only the `designSystem`
block in `plugin.json`.

A cockpit for long days: small controls, tight padding, ghost buttons, dense rows and tables, thin rings.

It names only what differs from the endue design system; every other component keeps the endue choice.
It works with any theme: the theme gives the colours and steps, this picks which of them each component
uses, so contrast stays the theme gate's.

Choose it in the design system studio, with `desk.design.use` (`{ "id": "endue.design-compact" }`), or
`desk.design.active: endue.design-compact` in `init.yaml`.

```bash
pnpm exec vitest run plugins/design-compact
cargo run -p desk-cli -- plugin validate plugins/design-compact
```
