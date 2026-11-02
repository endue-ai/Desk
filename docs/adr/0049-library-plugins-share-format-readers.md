---
status: accepted
date: 2026-11-02
decision-makers: Team endue
---

# Library plugins share format readers

## Context and Problem Statement

`endue.reader` needs the 7z and LZMA code `endue.archives` has to show CB7 comics, and the RAR
decoder `endue.archives` uses for CBR; disk images, DjVu and RAR decoders were coming, each needed by
more than one plugin. Copying them per plugin repeats thousands of lines (the codecs and the 7z reader
alone are about 3,500), and ADR 0037 and ADR 0045 left "serve shared code from the desk" as a later
decision. Where does code that several plugins import live, and how do they import it?

## Decision Drivers

* Plugin folders run as they are (ADR 0012): no build step, no change to the app binary for a decoder fix
* One copy of each reader, updated like a plugin
* Community plugins can do the same: ship a library, import a library
* The code runs with the importing plugin's grants, never its own

## Considered Options

* A plugin kind `library`: a folder the desk installs and serves, that other plugins import
* A bundle the app embeds and serves at `/_desk/formats.js`, like `@endue-ai/ui`
* Copies in each plugin, generated from one source by a script
* Copies in each plugin, by hand

## Decision Outcome

Chosen option: "a plugin kind `library`", because a library is installed, watched, served and updated
like any plugin, community plugins get the same mechanism, and nothing in the app changes when a
decoder does. An embedded bundle would tie every decoder fix to an app release; copies, generated or
not, still ship several versions of the same code.

* `specs/plugin/v0` gains the kind `library`. A library has no `entry`, surfaces, `contributes`,
  `permissions` or `autoload`: its modules run in the frame of the plugin that imports them, under that
  plugin's grants, so grants of its own would only mislead and autoload would turn it off.
* The core installs a library like a built-in plugin and keeps it enabled: `plugin.setEnabled` with
  `enabled: false` answers `unsupported`, and neither a stored flag nor init.yaml's `plugins.disabled`
  holds it off. The runtime mounts only `ui` plugins, so it never mounts one. `desk plugin validate`
  accepts a library without an entry.
* Consumers write `@endue-ai/formats/<folder>/<file>.js`: in the app through an import-map entry
  `"@endue-ai/formats/": "/endue.formats/lib/"` (an absolute path on the plugin scheme, so it resolves on
  every platform's form of it), in vitest through an alias and in `tsc` through `paths`. Workers, which
  import maps do not reach, import `new URL("/endue.formats/lib/...", import.meta.url)`.
* Inside a library, modules import each other relatively and never import the SDK or another plugin;
  `plugins/formats/tests/manifest.test.ts` fails any import that leaves `lib/`.
* The first library is `endue.formats` (`plugins/formats`), with the folders `codecs`, `sevenzip`, `rar`
  (ADR 0051), `djvu`, `disk`, `apple` and `packs`, each taking a ranged `Source` and answering the
  `Archive` shape `endue.archives` uses.

### Consequences

* Good, because a decoder is written once and `endue.archives` and `endue.reader` share it.
* Good, because a library updates and hot-reloads like a plugin and needs no app release.
* Bad, because a plugin cannot yet declare that it depends on a library: a missing library is a module
  load error in the consumer, and reloading a library does not reload the plugins that imported it.
* Bad, because the Plugins list shows a library with a switch that answers "unsupported".
* Neutral, because the file plugins' own ZIP and compound-file readers still live in each plugin;
  moving them is a later change.

## More Information

ADR 0012, ADR 0037, ADR 0045, ADR 0048, ADR 0051; `specs/plugin/v0/README.md` (Libraries),
`plugins/formats/README.md`; #181 and its PR #254.
