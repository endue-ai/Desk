# market/themes

The desk's first theme market (ADR 0060): `index.json`, a `ThemeIndex`
(`specs/plugin/v0/theme-index.schema.json`), and the `.desk-theme` bundles it lists. Desks read it from
`https://raw.githubusercontent.com/endue-ai/Desk/main/market/themes/index.json`, the default of the
setting `desk.theme.markets`, and the theme studio's Market tab shows its themes as cards: Preview
downloads one and shows it on the whole desk, Install brings it in with its sha256 checked.

## Publishing a theme

A theme is published by a pull request that adds its bundle and its index entry.

1. Make the theme in the studio (tune a copy, start from an image, or describe it) and export it, or
   write a theme plugin folder and run `desk theme export <id> <file>`. It passes the contrast gate in
   both schemes: the studio's editor shows its fixes, and
   `packages/runtime/src/theme-studio/market.test.ts` checks every theme here.
2. Give it an id inside `market.` (`market.<name>`), a version, `theme.author` and `theme.license`: an
   SPDX expression that covers its fonts and images too (`CC0-1.0`, `Apache-2.0`, `OFL-1.1`). Nothing
   from `brand/`.
3. Put it here as `<name>.desk-theme` and add its entry to `index.json`: `id`, `name`, `version`,
   `description`, `author`, `license`, `tags`, up to five `preview` colours, `url` (the file name),
   `sha256` and `size` (`shasum -a 256 <file>`, `wc -c <file>`).
4. Run `node scripts/theme-market.mjs` (part of `just check`), then open the pull request.

An update is a new `version` with its new bundle, `sha256` and `size`. A desk that installed the theme
replaces it with the update only while the person has not changed it; a theme they changed stays theirs.
