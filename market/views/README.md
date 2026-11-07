# market/views

The endue market's views (ADR 0107): `index.json`, a `MarketIndex` (`specs/market/v0`), and the
`.desk-plugin` bundles it lists, each a view plugin (`kind: view`, data only). Desks read it from
`https://raw.githubusercontent.com/endue-ai/Desk/main/market/views/index.json`, the default of the
setting `desk.market.indexes`, and Settings, Market lists its views with every other kind.

## Publishing a view

A view is published by a pull request that adds its bundle and its index entry.

1. Write a view plugin (`plugin.json` with `kind: view` and its `view`, `specs/view/v0`) and check it
   with `desk plugin validate <dir>`.
2. Give it an id inside `market.`, a version and a licence (SPDX).
3. Put it here as `<name>.desk-plugin` (`{ "format": "desk-plugin/1", "manifest": …, "files": {} }`)
   and add its entry to `index.json`: `id`, `kind: view`, `name`, `version`, `description`,
   `publisher`, `license`, `tags`, `url` (the file name), `sha256` and `size` (`shasum -a 256 <file>`,
   `wc -c <file>`), `permissions` (as the manifest asks) and `engines.desk`.
4. Run `node scripts/theme-market.mjs` (part of `just check`), then open the pull request.

An update is a new `version` with its new bundle, `sha256` and `size`. A desk asks again before it
installs an update that asks more permissions than the version it has.
