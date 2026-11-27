# The words of endue.database

What the views show a person comes from one catalog by a named key (PG-108, NF-06, ADR 0366).

- The catalog: `ui/strings/en.json`, in the desk's message format (ADR 0250, `specs/plugin/v0/messages.schema.json`):
  an id is camelCase words joined by dots, its first word the view (`grid.noRows`, `plan.columnShare`); a
  message is a text with `{name}` placeholders, or plural forms (`one`, `other`, and the rest of
  `Intl.PluralRules`' categories) that the `count` parameter picks. English is complete.
- The lookup: `ui/strings/index.js`. `t(key, params)` fills a message; a number parameter, the count among
  them, is written in the language's way (`Intl.NumberFormat`), so pass a string for a number that is not a
  quantity (an SRID, an ordinal). `nodes(key, params)` gives the message as text and nodes, for a message
  that holds one. `number(n)` writes any quantity, and `formatCount` (`ui/format.js`) goes through it.
  `clock(at)` and `day(at)` write a moment by the catalog's `format.time` and `format.date` patterns, with the
  language's digits, on the 24-hour clock.
- The language: the desk hands it to the plugin (`ctx.messages`, ADR 0250). `ui/main.js` loads its catalog
  before the page mounts and again on each change; what is drawn after a change follows it. A language with no
  file reads in English, and so does a key a language lacks.
- Adding a language: add `ui/strings/<language>.json` with the keys it translates. Nothing else changes: the
  manifest's `messages` already names the folder.
- The server's words: an error, a notice or a message from the server is shown as it came, never looked
  up. `serverWords(doc, text)` marks it (`data-words="server"`, `translate="no"`) inside the catalog's
  sentence around it (`copyImport.server`: "The server: {error}").
- A result's values are data: the grid, the value viewer and the exports show them as the server sent them,
  in every language (NF-10). Only the plugin's own interface is formatted.

## The lint

`scripts/strings-lint.mjs` runs in `just check` (its tests in `node --test scripts/*.test.mjs`). It reads
every view module of the plugin: a `.js` file under `ui/`, outside `vendor/`, named `view.js`, `view-*.js`
or `*-view.js`. A string or template literal there fails when it reads as words: a word with a capital
(`Run`), two words or more (`no rows`), a template with a placeholder and a word (`${n} rows`), or
anything with a letter put straight into what the page shows (`textContent`, `title`, `placeholder`,
`alt`, `label`, `aria-label`). Import specifiers, object keys, comparisons, `case` labels, `class`,
`style` and `value` values, selectors and KeyboardEvent key names never count. There is no baseline: the
view modules hold no literal a person reads.

Not caught: a lone lowercase word outside those places (`"read-only"` in an array), which the catalog's
tests (`tests/strings.test.ts`) do not see either. Review keeps them out.

## Not moved yet

The modules outside the views (feature panels and models, `commands.js`, `plugin.json`'s titles) and the
page's own HTML (`ui/index.html`) still hold English. Each moves the same way: a key in `en.json`, `t()` in
the code, and the module named in the lint's view pattern or in a target of its own.
