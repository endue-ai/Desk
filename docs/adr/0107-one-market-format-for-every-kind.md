---
status: accepted
date: 2026-11-06
decision-makers: Team endue
---

# One market format for every kind; code installs from the endue index only

## Context and Problem Statement

The theme market (ADR 0060) and its design systems (ADR 0091) let a desk install looks from an index of
bundles. Views, packs and plugins had no way in: no index format, no bridge method to install or remove,
nothing that shows what a plugin will be allowed before it lands, and no record of where an install came
from (plugins.lock, ADR 0079, can only say `builtin` or `folder:`). Killer feature 7 of the roadmap
(ADR 0093) is "install views, packs and design systems from the market". What format do markets publish,
and what may a desk install from whom?

## Decision Drivers

* One list for a person: every kind side by side, whatever market it came from
* Nothing runs on the desk that the person did not see asked, and an update cannot widen it silently
* Code is the dangerous kind; data (views, packs, looks) runs nothing (ADR 0017, ADR 0032)
* Signatures are not here yet (ADR 0005); the sha256 in an index is what pins a bundle today
* The theme markets keep working unchanged

## Considered Options

* `specs/market/v0`: one index format whose entries carry a kind, and a `.desk-plugin` bundle; the
  theme markets read beside it
* Widen `ThemeIndex` to every kind
* Per-kind indexes (a view index, a plugin index, …)

## Decision Outcome

Chosen option: "`specs/market/v0`", because it names what every kind needs (publisher, licence,
permissions, engines) without breaking the theme index, which the theme studio and the published markets
already use. `market.list` reads the indexes `desk.market.indexes` lists and the theme markets, each id
once, the first market winning, and says per entry whether it is verified, its state and `added`: the
permissions it asks that the installed version was not given. `plugin.install` needs every asked
permission in `accept` and grants exactly those; the record beside the install keeps them, so the next
start grants them again and an update that asks more is refused until it is accepted. A bundle must match
its entry's sha256 and size, and be a plugin folder of the entry's id, version and kind. Code (`kind:
plugin`) installs only from the endue index (this repository's `market/`); views and packs from any index
install marked "not verified". plugins.lock records an install as `url:<bundle URL>`.

### Consequences

* Good, because a view, a pack or a plugin is one pull request to `market/` away from every desk, and the
  same lint that checks the theme markets checks it.
* Good, because the permission a plugin will hold is shown before it lands and cannot grow without a
  second yes.
* Bad, because third-party code has no way in until signatures exist; a developer installs from a folder
  (`DESK_DEV_PLUGINS`) meanwhile.
* Bad, because there are two index formats until the theme markets move to `desk-market-index/1`.
* Bad, because the endue index is trusted by its URL prefix, not by a key: whoever can change this
  repository's `market/` can publish code. Review of those pull requests is the gate until ADR 0005.

## More Information

`specs/market/v0`, `specs/bridge/v0/market.schema.json`, `crates/desk-core/src/core_marketplace.rs`,
`market/views`, `plugins/market`, Settings, Market (`packages/runtime/src/settings-ui/market.ts`),
`desk market list|install`. ADR 0005, ADR 0060, ADR 0079, ADR 0091, ADR 0093. Issue #475.
