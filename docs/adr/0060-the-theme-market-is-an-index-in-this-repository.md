---
status: accepted
date: 2026-11-02
decision-makers: Team endue
---

# The theme market is an index in this repository

## Context and Problem Statement

The owner's decision is that there is a theme market (`docs/ko/theme-requirements.md` TC-05, TS-08):
people find themes in the studio, preview them before they install them, install them with the bytes
checked, and get updates. ADR 0058 made a theme travel as one `.desk-theme` file and gave market themes
their own ids (`market.`). Where does the market live, how does the desk read it, how is a download
trusted, and how does an update tell a theme the market changed from one the person changed?

## Decision Drivers

* Publishing a theme should need nothing but a review: no account, no server, no upload tool
* A downloaded theme is the bytes its reviewer saw, or nothing lands
* More than one market, without a central registry
* Previewing never installs; installing never applies (ADR 0056)
* An update never overwrites what the person made their own

## Considered Options

* An index file (`ThemeIndex`) next to the bundles in this repository, read from GitHub's raw URLs on
  `main`; the setting `desk.theme.markets` lists the indexes the desk reads
* A market service with an API, accounts and uploads
* Themes as npm packages, found through the npm registry

## Decision Outcome

Chosen option: "an index file next to the bundles in this repository", because publishing becomes a
pull request that CI checks and a person reviews, the desk needs nothing but https and sha256, and any
other market is one more URL.

* `market/themes/index.json` (`desk-theme-index/1`) lists each theme's card (`id` inside `market.`,
  `name`, `version`, `description`, `author`, `license`, `tags`, `preview`) and its bundle's `url`
  (relative to the index, so a market moves with its folder), `sha256` and `size`.
  `scripts/theme-market.mjs` checks every entry in `just check`: the schema, unique ids, the hash and
  size, a licence, and the bundle as a valid theme plugin; a test gates every theme in both schemes.
* `desk.theme.markets` is a list of index URLs; its default is this repository's raw index on `main`.
  A later CDN changes only the default.
* `theme.market.list` (`theme:manage`) downloads each index over https from its own host only, checks
  it against the schema and merges the themes by id, the first market winning; an index that fails is
  named in `problems` and the others still list.
* `theme.market.fetch` downloads a bundle to preview it: refused unless its bytes match `sha256`,
  checked as a theme plugin in a temporary folder that goes again, and answered as the bundle, which the
  studio previews as a draft. Nothing is installed.
* Installing is `theme.import` with `url`, `sha256` and `market`. Beside a `market.` theme the core
  keeps `<data>/themes/.market/<id>.json`: the market, URL, version, sha256 and a hash of the folder as
  it landed. The list says `installed`, `update` (unchanged, and the market has other bytes) or `edited`
  (changed since, or brought in from a file); an import by URL replaces a market theme only while its
  folder still has the hash it landed with.

### Consequences

* Good, because a market theme is reviewed like code and its bytes are pinned by the index
* Good, because a person's changes to a market theme are never lost to an update
* Good, because a second market is a URL in `init.yaml`, with no trust in a central service
* Bad, because the first market's availability is GitHub's, and publishing waits for a merge
* Bad, because the index is fetched whole on every list; a market of thousands of themes would want
  pages or a cache

## More Information

`specs/plugin/v0/theme-index.schema.json`, `specs/bridge/v0/theme.schema.json` (`theme.market.*`),
`crates/desk-core/src/core_market.rs`, `market/themes/README.md`, `scripts/theme-market.mjs`,
`packages/runtime/src/theme-studio/market.ts`, `docs/plugins/authoring.md` ("The market"), ADR 0056,
ADR 0058, issue #306.
