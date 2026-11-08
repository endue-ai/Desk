---
status: accepted
date: 2026-11-02
decision-makers: Team endue
---

# User themes live in the data folder and travel as one file

## Context and Problem Statement

ADR 0056 makes themes a core system and ADR 0057 makes a theme a plugin of kind `theme`. The owner's
decision is that people make themes, share them, and get them from a market. A theme the person tunes
in the studio, one a friend sends and one from a market must all be kept somewhere the core installs
from, and must cross from one desk to another. Where do the person's themes live, who may write them,
and what is the file people pass around?

## Decision Drivers

* A saved or imported theme is an ordinary theme plugin: one validator, one serving path, one engine
* Nothing half-written: a theme that fails its check never replaces a working one
* Built-in themes and other plugins can never be overwritten by a theme someone sends
* One file, readable and diffable, that a person, an agent or a market can produce without tools
* A theme from the network is the bytes its publisher meant, or nothing

## Considered Options

* Theme plugins in `<data>/themes/<id>/`, written only by the core through `theme.*` under
  `theme:manage`; a `.desk-theme` file is one JSON document with the manifest and its files in base64
* The same folder, with a zip archive as the shared file
* Themes as values in the settings or the store, without folders

## Decision Outcome

Chosen option: "theme plugins in `<data>/themes/<id>/` and a JSON `.desk-theme`", because it reuses
plugin installation, validation and serving as they are, and a JSON bundle needs no archive code, is
read by any language and is checked by the same schemas as everything else.

* The app hands the core the folder (`Core::with_themes_dir`); the core installs every theme folder in
  it at start, not built in, and watches it (`Core::watch_themes`), so a folder added, changed or
  deleted by hand is installed, refreshed or removed.
* User theme ids are inside `local.` (saved or imported by the person) or `market.` (#306). A bundle
  with any other id lands as `local.<its name as a slug>`; an id a built-in or any plugin outside the
  folder holds is `already_exists`.
* `theme.save`, `theme.import`, `theme.export` and `theme.remove` need `theme:manage`, granted to the
  runtime and the CLI only. Agents reach themes through the CLI or the studio, as the person does.
* A save or import writes a hidden folder beside the others, runs `validate_dir` on it, and only then
  swaps it in; on any failure the folder goes and the earlier theme stays.
* A `.desk-theme` is `{ "format": "desk-theme/1", "manifest", "files": { path: base64 } }`, 16 MiB at
  most, holding only the files the theme block names. Export is deterministic, so an exported theme
  imported and exported again is the same bytes.
* Import by URL is `https` only, to the URL's host only, and refused unless the bytes match the
  `sha256` given with it.
* `theme.save` takes `copyFrom`: a tuned copy keeps the fonts and images of the theme it started from,
  which the webview cannot read itself.

### Consequences

* Good, because a user theme is served, validated and applied exactly like a built-in one
* Good, because a failed save or a tampered download changes nothing on disk
* Good, because a bundle is one readable file a market index can hash and a person can review
* Bad, because base64 makes a bundle about a third larger than its assets
* Bad, because the folder is only as private as the data folder; a theme is values and assets, never
  code, so it carries no secret and runs nothing

Note, 2026-11-02: the app's part landed in PR #352 (#311). `apps/desk/src-tauri` passes
`<app data>/themes/` to `Core::with_themes_dir`, runs `Core::watch_themes` beside hot reload (which
leaves the folders in it to `watch_themes`, so each change is announced once), and grants
`theme:manage` to the runtime and to the CLI's socket caller. `e2e/specs/themes.spec.ts` checks it in
the app. The decision above is unchanged.

## More Information

`specs/bridge/v0/theme.schema.json`, `specs/plugin/v0/theme.schema.json` (`ThemeBundle`),
`specs/bridge/v0/README.md` (theme.*), `crates/desk-core/src/core_themes.rs`,
`docs/ko/theme-requirements.md` (TC-01 to TC-04), ADR 0056, ADR 0057, issue #302. The app passes
`<data>/themes/` and grants `theme:manage` to the runtime and the CLI in a follow-up.
