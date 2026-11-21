---
status: proposed
date: 2026-11-21
decision-makers: Team endue
---

# The shell reads desk.language from the core and words itself from catalogs it embeds

## Context and Problem Statement

ADR 0250 gave the desk `desk.language` and message catalogs. The runtime keeps the setting in its
own layers (init.yaml, the profile, the preferences it stores), which the Rust shell cannot read.
The shell's menu bar, tray, dialog titles and its own notices were English only (#360). The shell
has to know the language at start, before the runtime's page is up, and follow a change without a
restart. Where its catalogs live, and the name the language has in the core, are hard to change
once copy tools and other modules depend on them.

## Decision Drivers

* One choice for the whole desk: the shell must speak what Settings › General shows.
* The shell words its menus before the runtime loads, and the runtime may never load (safe mode, a
  page that fails).
* The same catalog format as the runtime and the plugins, so one copy tool reads them all.
* No new dependency and no new bridge method.

## Considered Options

1. The runtime writes the choice to the core as its own setting `language` (owner `desk`). The
   shell reads it with `settings.get` and follows `settings.changed`.
2. The page tells the shell the language through a `desk_*` command of the shell's.
3. The runtime writes the language it resolved (`en` or `ko`) instead of the choice.
4. The shell reads the runtime's stored preferences record from the store.

## Decision Outcome

Chosen option: 1, because it is how `desk.palette.shortcut` (`palette.shortcut`) and
`desk.update.channel` (`update.channel`) already reach the shell and the core. init.yaml's
`desk.language` already reads there: the core files it under owner `desk` and key `language`. The
value survives in `settings.json`, so the next start speaks it before the page is up.

* **The runtime** writes the choice in force once its settings are in, and only when the core holds
  another, then after each change (`mirrorLanguage`, `packages/runtime/src/policies/language.ts`).
  While the settings load it writes nothing, so the shell keeps the language it started with.
* **The shell** holds the choice, not a language. `system`, an unknown value or no value is the
  first of the OS's languages the desk speaks, else English, as `resolveLanguage` decides it.
  macOS gives `NSLocale.preferredLanguages`; elsewhere the shell reads `LANGUAGE`, `LC_ALL`,
  `LC_MESSAGES` and `LANG`. `apps/desk/shell/src/language.rs` reads it at start and follows it.
* **Catalogs**: `apps/desk/shell/messages/{en,ko}.json` in `messages.schema.json`'s format. They
  are embedded with `include_str!`, and their ids are `desk.<area>.<name>`. The runtime's catalog
  test validates them with the others. The lookup in `words.rs` is a Rust twin of `messageText`.
* **A change** re-words the menu bar's items in place (`set_text`), so AppKit keeps the windows it
  lists under Window, and the tray gets a new menu. The menu bar names AppKit's standard items in
  the desk's words too. The ones AppKit adds by itself stay its own.

### Consequences

* Good, because the menu bar, the tray, the open and save dialogs' default titles, a link's
  refusal and the notices about taken keys all follow one setting at once.
* Good, because the shell speaks the last choice at the next start, before the runtime loads.
* Bad, because the same choice is now stored in two places, the runtime's preferences and the
  core's `settings.json`. The runtime keeps them equal, and a desk without a runtime keeps the
  last one written.
* Bad, because `system` is resolved twice, by the page from `navigator.languages` and by the shell
  from the OS. They agree unless CEF's locale differs from the OS's.
* Bad, because two lookups (TypeScript and Rust) must keep the same fallback rules. The shell's
  tests check its own.
* Not covered: log lines and errors returned to callers stay English. Also left: the text field's
  menu (`web_host/`), the computer-use banner, the floating windows' titles and `desk-link`'s
  grammar refusals, as follow-ups.

## More Information

* Code: `apps/desk/shell/src/{language,words}.rs`, `menu.rs` with `menu/model.rs`, `tray.rs`,
  `dialog/save.rs`, `open_files.rs`, `palette/shortcut.rs`, `eris_window/shortcut.rs`.
* Tests: `apps/desk/shell/tests/words.rs`, `packages/runtime/src/policies/language.test.ts`,
  `packages/runtime/src/i18n/catalogs.test.ts`.
