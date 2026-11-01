---
status: accepted
date: 2026-11-01
decision-makers: Team endue
---

# File plugins autoload: off until a file needs them, off again after its last one

## Context and Problem Statement

Every installed plugin started on unless the person or `init.yaml` said otherwise. Under the shell
every centre surface is a tiled window (ADR 0040), so the nine file plugins (`endue.sheets`,
`endue.docs`, `endue.slides`, `endue.reader`, `endue.images`, `endue.player`, `endue.data`,
`endue.archives`, `endue.web`) opened nine empty "No file open" windows at every start, shrank every
other window to a strip and loaded megabytes of vendored code (pdf.js, SheetJS) that nobody had asked
for. Once the second of them merged, the app e2e session spec could no longer click the test plugin's
window. A file plugin is only useful while it holds a file. How does a plugin say so, and who turns
it on and off?

## Decision Drivers

* A fresh start shows what the person uses, not one window per installed file format
* Opening a file must still find its plugin, as `auto-mode-alist` finds a mode that is not loaded
* What the person turned on or off by hand, a stored flag and `init.yaml` keep their meaning
* A plugin cannot turn itself off; the desk knows which buffers are open (ADR 0017)
* Additive to `specs/plugin/v0`: community plugins can use it, and old manifests mean what they meant

## Considered Options

* `autoload` in the manifest, Emacs's autoload: off at start, its file openers count while it is off,
  `desk.files` turns it on for a file and off again after its last buffer
* Turn the nine off in `init.yaml`'s template or a profile
* Keep them on but mount their surfaces lazily, only when a file arrives
* Leave every plugin on and let the shell hide empty windows

## Decision Outcome

Chosen option: "`autoload` in the manifest", because it says what a file plugin is (installed,
loaded when first needed) in the place that describes the plugin, and keeps every other plugin as it
was.

* `specs/plugin/v0` gains the optional boolean `autoload`, default false. The core's registry treats
  an autoload plugin with no stored enabled flag as off; a stored flag and `init.yaml`'s
  `plugins.disabled` still decide (`crates/desk-core/src/plugins.rs`).
* The runtime collects an off autoload plugin's file openers in its layer, like an autoload cookie,
  and nothing else of it: its commands, keys and settings count once it is on (`policy.ts`).
* `desk.files` turns an off opener on as before. When the opener is an autoload plugin that was off,
  it remembers it (in the store, `files.autoloaded`, so a restart still knows); when that plugin's
  last buffer closes (after it heard `desk.buffers.closed`, or with its window), the desk takes the
  window away and turns the plugin off. A plugin the person turned on (the dock, `desk plugin
  enable`) is not remembered and stays on; turned off by hand, a remembered plugin is forgotten.
* The flag `desk.files` sets persists as any flag, so a file left open at quit comes back with its
  plugin through `desk.session`; once the session is back, a remembered plugin that holds no file is
  turned off (`files.settle`).
* Profiles leave autoload plugins as they are: a switch neither turns them on (the plugins it
  enables, or brings back after an earlier switch) nor off, and a saved profile does not list them.
* The nine file plugins declare `"autoload": true`.

### Consequences

* Good, because a fresh start has no file-plugin windows and loads none of their code, and the app
  e2e session spec passes again unchanged.
* Good, because any plugin can autoload with one manifest field; the core's change is one default.
* Bad, because an autoload plugin's commands, keys and settings are not offered while it is off
  (the palette, the settings list); autoloading for commands or keys is a later decision.
* Bad, because `desk.files` now keeps a little state across restarts (`files.autoloaded`) beside the
  core's enabled flags.

## More Information

Builds on ADR 0017 (policies as plugins, the Emacs analogy) and ADR 0040 (centre surfaces as the
shell's windows). `crates/desk-core/tests/autoload.rs`,
`packages/runtime/src/policies/files-autoload.test.ts`,
`packages/runtime/src/policies/profiles-autoload.test.ts`, `packages/runtime/e2e/files.spec.ts`.
Out of scope: autoload for commands or keys, lazy mounting inside a plugin that is on.
