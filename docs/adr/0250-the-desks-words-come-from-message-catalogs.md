---
status: proposed
date: 2026-11-16
decision-makers: Team endue
---

# The desk's words come from message catalogs

## Context and Problem Statement

The desk speaks English and Korean, but neither language had a catalog. The runtime kept each
string as a pair inline, `[ko, en]` tables picked with `lang === "ko" ? 0 : 1` and ternaries in
place. The default language was fixed to Korean (`shell/Desk.ts`), and nothing let a person choose
it. Plugins had no way to ship their own words, so each one invented its own (#316). Code, plugins
and translators will depend on the file format and the manifest field, so both are hard to change
later.

## Decision Drivers

* One lookup for the desk and the plugins, with English as the fallback.
* A file a translator can edit without reading code. A plugin's catalogs must be readable as data,
  without running the plugin.
* Parameters and plurals, without a parser or a dependency.
* Many tasks run at once (ADR 0015), so no single file should hold every string.

## Considered Options

1. One JSON file per language. Each maps a flat message id to a text, or to a plural object keyed by
   Intl.PluralRules categories. Parameters are written `{name}`.
2. ICU MessageFormat strings (`{count, plural, one {…} other {…}}`) in JSON.
3. Fluent (`.ftl`) files.
4. gettext `.po` files.

## Decision Outcome

Chosen option: 1. The person accepted it on #316.

* **Catalog** (`specs/plugin/v0/messages.schema.json`): `<folder>/<language>.json`, with `en.json`
  required and complete. An id is camelCase words joined by dots (`frames.notResponding`). A message
  is either a text or `{ zero?, one?, two?, few?, many?, other }`. The `count` parameter picks the
  form through `Intl.PluralRules` of the catalog's language. A text's `{name}` is replaced by the
  parameter of that name, and a parameter not given reads as nothing. A lookup with no parameters
  leaves the text as written, for a caller that fills it later. A language that lacks an id reads it
  in English, and an id English lacks too reads as the id itself.
* **Lookup**: `messageText(catalogs, language, id, params?)` in `@endue-ai/bridge`. The runtime and
  the plugin SDK both depend on that package already.
* **Runtime catalogs**: these sit next to their module, as `<module>/messages/{en,ko}.json`. Each id
  starts with the module's name, and each module's copy file imports its own two files through
  `moduleText` (`packages/runtime/src/i18n/messages.ts`). There is no shared index, so tasks that
  move other modules do not collide.
* **Setting**: the core setting `desk.language` is `system` (the default), `en` or `ko`. `system`
  uses the OS's language when the desk speaks it, and English otherwise. The app names the OS's
  language when it mounts the desk. Settings › General has the row (Follow the system, English,
  한국어). This setting is the desk's own; the endue account's display language (ADR 0130) stays
  separate.
* **Plugins**: the manifest's optional `messages` names the folder of the plugin's catalogs. The
  runtime puts `language` and `messages` on `desk:init` and sends `desk:language` to every frame on
  each change. The SDK's `ctx.messages` loads the catalogs from the plugin's own origin. It has
  `t(id, params)`, `language()`, `onChange(listener)` and `ready`, and `defineUiPlugin` mounts once
  the catalogs are in.
* **Check**: `scripts/copy-lint.mjs` runs in `just check`. It counts comparisons with `"ko"` per
  source file against `scripts/copy-lint-baseline.json`. A new one fails, a count that grows fails,
  and a file at zero must leave the baseline.

### Consequences

* Good: one format and one lookup serve the desk and every plugin. A plugin's words are data, a
  translator edits one JSON file, and adding a language means adding files.
* Good: if a translation is missing, the English shows instead of a blank, and a missing id shows
  as itself.
* Bad: plurals and parameters are all the format does. There is no select, gender, or number or
  date formatting; ICU MessageFormat would have given those. A later version can add a message
  shape without breaking these files.
* Bad: a change applies at once to the shell, the settings window and the plugins. Words a module
  fixed when it was installed (command titles, the frames' and the keys' notices) follow at the
  next start, until their modules read the language live.
* Bad: part of the runtime still holds pairs inline, in the files the baseline lists, until
  follow-ups move them.

## More Information

* Spec: `specs/plugin/v0/messages.schema.json` and `plugin.schema.json` (`messages`), plus the
  vectors `plugin-messages*` and `messages-*`.
* Code: `packages/bridge/src/messages.ts`, `packages/runtime/src/policies/language.ts`,
  `settings-ui/language-row.ts`, `settings-ui/live-window.ts`, `plugins-init.ts`, and
  `packages/plugin-sdk/src/messages.ts`.
* Tests: `messages.test.ts` (bridge, SDK), `policies/language.test.ts`,
  `settings-ui/language-row.test.ts`, `i18n/catalogs.test.ts` and `scripts/copy-lint.test.mjs`.
