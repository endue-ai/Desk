---
status: accepted
date: 2026-10-31
decision-makers: Team endue
---

# The terminal plugin emulates with xterm.js, vendored into its folder

## Context and Problem Statement

A terminal surface needs a VT100/xterm emulator: cursor movement, colours, the alternate screen,
scrollback, wide characters, bracketed paste, mouse reporting. UI plugins are folders that run as they
are (ADR 0012): no build step, a sandboxed frame whose CSP allows scripts only from the plugin's own
folder and the SDK the desk serves. Where does the emulator come from, and how does the terminal
plugin, built in but in the community format, load it?

## Decision Drivers

* Production emulation on the first day: writing a VT parser is years of edge cases
* A plugin folder runs as it is, in development and in a release build alike (ADR 0012)
* One copy, reproducible from a pinned version, with its licence next to it
* The emulator is the terminal's concern, not the desk's: no new API surface for other plugins

## Considered Options

* Vendor xterm.js and its addons into `plugins/terminal/ui/vendor/`, pinned, copied by a script
* Serve xterm.js from the app at `/_desk/xterm.js`, next to the SDK, for every plugin
* A build step for the plugin that bundles xterm.js from `node_modules` into its entry
* Write an emulator of our own in `ui/`

## Decision Outcome

Chosen option: "vendor xterm.js into the plugin folder", because the folder then runs as it is, the
copy is reproducible, and the desk's API gains nothing it would have to keep.

* `plugins/terminal/package.json` pins `@xterm/xterm`, `@xterm/addon-fit` and `@xterm/addon-unicode11`
  to exact versions. `just vendor-terminal` (`scripts/vendor-xterm.mjs`) copies their ES modules,
  the stylesheet and licences into `ui/vendor/`, drops the source-map comments and writes `VERSIONS`.
* `scripts/vendor-xterm.test.mjs` fails `just test-unit` when the committed copy differs from the
  pinned packages, as `codegen-check` does for generated files. Updating is: bump the pin, run the
  recipe, commit.
* `ui/vendor/` is third-party: biome leaves it alone, `.gitattributes` marks it `linguist-vendored`
  and shows no diff for it. Everything the plugin does with the emulator stays in `ui/view.js`, so
  the plugin's own code keeps to the 400-line rule and the emulator is swapped in one file.
* The SDK and the desk's protocol are untouched. Should a second plugin need an emulator, serving one
  copy from the app is the next decision, not this one.

### Consequences

* Good, because the terminal emulates like VS Code's and Hyper's from the first release, under MIT.
* Good, because a community plugin can do exactly the same: the built-in sets the pattern.
* Bad, because 380 KiB of third-party code is in the repository and updates are by hand.
* Bad, because the vendored module is loaded as is: a bug in xterm.js is fixed by a version bump, not
  a patch, and tree shaking is not possible.

## More Information

`plugins/terminal/README.md`, `docs/ko/terminal-requirements.md` (TERM-E01, the "결정" table),
ADR 0012 (plugins run from their folder), `scripts/vendor-xterm.mjs`.
