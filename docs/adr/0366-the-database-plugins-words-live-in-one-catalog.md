---
status: proposed
date: 2026-11-23
decision-makers: Team endue
---

# The database plugin's words live in one catalog

## Context and Problem Statement

PG-108 (#503, NF-06): the database plugin wrote every string a person reads in English, inline, across
its view modules. Translating it meant editing code in dozens of files. The desk already hands plugins a
language and a message format (ADR 0250: `<folder>/<language>.json`, `ctx.messages`), but the plugin's
views are plain modules that tests import without the SDK, draw synchronously, and format counts and
times of their own. Where do the words live, how do the views read them, and what keeps a new literal
from coming back?

## Decision Drivers

* Translating means adding one file; the format is the desk's, so a translator learns one.
* The views keep importing without the SDK (tests run them in jsdom), and draw with English at once.
* Counts are plural-aware, and the interface's numbers and dates follow the language; a result's
  values never do (NF-10).
* The server's messages stay the server's.
* A check in `just check` that fails on a new literal, precise enough to have no baseline.

## Considered Options

1. ADR 0250's catalog in `ui/strings/<language>.json`, read by a module of the plugin's own
   (`ui/strings/index.js`) that imports English as a JSON module and loads another language's file
   next to it; a token-based lint of the view modules.
2. Only `ctx.messages.t`, passed into every view.
3. A JavaScript object per language (`ui/strings/en.js`).

## Decision Outcome

Chosen option: 1.

* **Catalog**: `ui/strings/en.json`, in `messages.schema.json`'s format, named by the manifest's
  `messages` (`ui/strings`). Keys start with their view (`grid.`, `plan.`, `tableDesign.`). English is
  complete; another language may lack keys, which then read in English.
* **Lookup**: `t(key, params)` fills `{name}`s and picks a plural form by `count` with
  `Intl.PluralRules`; a number parameter is written with `Intl.NumberFormat` in the language, so a
  number that is not a quantity is passed as a string. `nodes` returns text and nodes for a message that
  holds one; `clock` and `day` place `Intl.DateTimeFormat`'s parts by the catalog's `format.*` patterns,
  so English reads as before (`14:05`, `2026-11-20`). This is ADR 0250's format with one addition the
  shared lookup does not have: the count is formatted, not printed raw.
* **Language**: `ui/main.js` reads `ctx.messages.language()` and loads `ui/strings/<language>.json`
  before mounting, and again on each change; what is drawn after the change follows it.
* **The server's words**: never looked up. `serverWords` wraps them in a span marked
  `data-words="server"` and `translate="no"`.
* **Check**: `scripts/strings-lint.mjs` in `just check`, with its tests. It tokenizes each view module
  (`view.js`, `view-*.js`, `*-view.js` under `plugins/database/ui/`, outside `vendor/`) and fails on a
  string or template literal that reads as words (a capitalised word, two words, a template with a
  placeholder and a word, or any letter put straight into a text sink), except where words cannot be
  (specifiers, keys, comparisons, `case` labels, classes, styles, values, selectors, key names). No
  baseline.

### Consequences

* Good: a translation is one JSON file next to `en.json`; tests read the words through the catalog, so
  a wording change is made once.
* Good: plural forms, the interface's numbers and its times follow the language; values do not.
* Bad: a lone lowercase word outside a text sink escapes the lint; review catches it.
* Bad: the modules outside the views (feature panels, models, commands) and `ui/index.html` still hold
  English until follow-ups move them the same way.
* Bad: the page imports a JSON module (`with { type: "json" }`), which needs the desk's engine to serve
  `.json` as `application/json`, as it does.
