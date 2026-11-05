# market/design-systems

The desk's first design system market (ADR 0091): `index.json`, a `ThemeIndex`
(`specs/plugin/v0/theme-index.schema.json`) whose entries are of `kind: design-system`, and the
`.desk-design` bundles it lists. Desks read it from
`https://raw.githubusercontent.com/endue-ai/Desk/main/market/design-systems/index.json`, which is in the
default of `desk.theme.markets` (the look markets), and the design system studio's Market tab shows its
design systems: Preview downloads one and shows it on the whole desk, Install brings it in with its
sha256 checked.

## Publishing a design system

A design system is published by a pull request that adds its bundle and its index entry.

1. Make it in the design system studio (tune a copy, or describe it) and export it, or write a
   design-system plugin folder and export it with `desk.design.export`. A design system holds no
   colours, so it passes the theme gate under every theme.
2. Give it an id inside `market.` (`market.<name>`), a version, `designSystem.author` and
   `designSystem.license` (an SPDX expression). Name only what differs from the endue design system.
3. Put it here as `<name>.desk-design` and add its entry to `index.json`: `id`, `name`, `version`,
   `kind: design-system`, `description`, `author`, `license`, `tags`, up to five `preview` colours,
   `url` (the file name), `sha256` and `size` (`shasum -a 256 <file>`, `wc -c <file>`).
4. Run `node scripts/theme-market.mjs` (part of `just check`), then open the pull request.

An update is a new `version` with its new bundle, `sha256` and `size`, as for themes.
