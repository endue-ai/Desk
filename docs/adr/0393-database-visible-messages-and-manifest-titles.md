---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Database visible messages and manifest titles

## Context and Problem Statement

The database plugin moved its view strings into a catalog in ADR 0366. Models, operation
messages, static markup and command titles still held English strings. The copy check was limited
to files named as views. A host also has to register command titles before loading a plugin page.

## Decision Drivers

- Keep the existing English text, interpolation and program data.
- Check every first-party module and page without a file or literal baseline.
- Resolve plugin title messages without running a plugin's code.

## Considered Options

- Keep separate inline labels in models and the manifest.
- Use ADR 0250 catalogs in the plugin and resolve optional manifest title keys in the runtime.

## Decision Outcome

Database uses `t()` for its words in modules and markup. The existing catalog and the English
catalogs grouped by feature load into one lookup. The static page names messages with
`data-message` attributes. It applies them when its view opens and reapplies them on language
change while keeping values the live view has replaced. SQL, program identifiers and database
server output remain data.

The plugin manifest's optional `titleMessage` for a command or surface names a key in its
declared `messages` folder. The runtime reads catalog data through the existing plugin asset
URL when listing plugins. The chosen language falls back to English, and the literal
`title` serves as the fallback when the entry or catalog is unavailable. Older manifests
still use their literal titles.

The strings check reads all JavaScript modules and static markup outside `vendor/`. It detects
display sinks, named messages, prose, static attributes and visible text nodes, while the
view modules retain their prior lexical check.

## Consequences

- Database feature catalogs and the manifest catalog follow ADR 0250's message shape.
- A new command or surface can add a localized title before its plugin window opens.
- The copy check preserves program strings by their syntax and use. It does not read raw server data.

## More Information

ADR 0250, ADR 0366, and issue #692.
