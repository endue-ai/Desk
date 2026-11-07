# Desk market v0

One market format for every kind a desk installs (ADR 0107): themes, design systems, views, packs and
plugins. It generalises the theme market (ADR 0060, `specs/plugin/v0/theme-index.schema.json`), which
keeps serving themes and design systems as it does. v0 may break on any minor release (ADR 0004).

| Definition | What it is |
| --- | --- |
| `MarketIndex` | A market's `index.json`: `format: desk-market-index/1` and its `entries`, each id once |
| `MarketEntry` | `id`, `kind`, `name`, `version`, `description`, `publisher`, `license` (SPDX), `tags`, `url` (relative to the index, or https), `sha256` and `size` of the bundle, `permissions` it asks, `engines.desk` (`>=0.1.0`) |
| `MarketKind` | `theme`, `design-system`, `view`, `pack` or `plugin` (anything that runs code) |
| `PluginBundle` | A `.desk-plugin`: JSON, 16 MiB at most, `format: desk-plugin/1`, the `manifest` and every other file of the folder base64 by its path (no dot files) |

- A desk reads the indexes the setting `desk.market.indexes` lists (default: this repository's
  `market/views/index.json`), and lists the theme markets' themes and design systems with them; the
  first index that lists an id wins.
- The endue index is what `https://raw.githubusercontent.com/endue-ai/Desk/main/market/` serves. Code
  (`plugin`) installs from it only; anything from another index is shown as not verified (signatures
  later, ADR 0005).
- Before an install the desk shows the permissions the entry asks that the installed version was not
  given (`added`); `plugin.install` needs every one accepted, and grants them. A bundle whose bytes do
  not match `sha256` and `size`, or whose manifest is not the entry's id, version and kind, is refused.
- An install is recorded in plugins.lock as `url:<bundle URL>`.

`vectors/` holds valid and invalid indexes, entries and bundles.
