---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# The SQL console edits in a vendored editor component, highlighted by the plugin's own lexer

## Context and Problem Statement

The database plugin's console was a textarea with a highlighted copy of its text under it. It could
not find and replace, hold several carets, select a column, mark a bracket's partner, fold a
statement or keep an undo history per console, and it highlighted the whole text on every change, so
a 5 MB script stalled each key press. A plugin folder runs as it is (ADR 0012): no build step, and a
sandboxed frame that loads scripts only from the plugin's folder and the SDK. Where does a code
editor come from, and what does the plugin keep of its own?

## Decision Drivers

* The editing a SQL console needs, on the first day, without years of edge cases of our own
* A plugin folder runs as it is, offline, in development and in a release build alike (ADR 0012)
* One copy, reproducible from pinned versions, with its licences next to it (as ADR 0037, ADR 0042)
* The plugin's lexer stays the one truth for what is a string, a comment or a statement: the editor
  draws what the client will run
* A 5 MB script scrolls and takes typing without a visible stall
* Every colour from the theme's `--desk-*` tokens; the keyboard and a screen reader no worse

## Considered Options

* Vendor CodeMirror 6 (MIT, modular) as one pinned ES module bundled by a script
* Vendor CodeMirror 6's packages one module each, their bare imports rewritten to relative paths
* Serve an editor from the app at `/_desk/`, next to the SDK, for every plugin
* Write the editing features over the textarea and its highlighted copy
* For the lexing of a large script: a worker, or slices on the frame's main thread

## Decision Outcome

Chosen option: "vendor CodeMirror 6 as one pinned ES module", because its packages import each other
by bare name, which a plugin page cannot resolve, and one bundle made by a pinned bundler is the
smallest reproducible copy; the desk's API gains nothing it would have to keep.

* The root `package.json` pins `@codemirror/{state,view,commands,search,autocomplete,language}`,
  every package they bring in and `esbuild` to exact versions (pnpm `overrides` hold the two shared
  ones). `node scripts/vendor-codemirror.mjs` bundles them into
  `plugins/database/ui/vendor/editor/editor-component.mjs` with `LICENSE` (each package's) and `VERSIONS`;
  `scripts/vendor-codemirror.test.mjs` fails `just test-unit` when the committed copy differs, a
  package is not pinned, or the bundle imports or fetches anything. Updating is: bump the pins, run
  the script, commit.
* No language package is bundled. `ui/editor/tokens.js` lexes from checkpoints at line starts every
  16 KiB, each with the lexer's state (MySQL's delimiter, whether a statement may start), so the lines
  on screen cost a window, not the script; after an edit the checkpoints before it stay and the later
  ones are checked again in idle slices of at most 4 ms until one agrees. Highlighting, bracket and
  quote partners, folds and the statement completion sees come from those tokens (`ui/editor/*`).
* The textarea stays in the page as the handle `view.js` holds (value, selection, focus); the editor
  answers for it, so the surface did not change but for the console's id passed to `show`.
* The component's own stylesheet is overridden from `#editor-box`, so the theme's tokens win.
* Chords the desk binds are left to the desk: the next occurrence is Alt+J, a line comment Mod+Alt+/.

### Consequences

* Good, because find and replace, several carets, column selection, folding and history per console
  come from a maintained component, under MIT, without a build step for the plugin.
* Good, because a 5 MB script measured 32–36 ms for the frame's longest task while scrolling and
  typing (`packages/runtime/e2e/database-editor.spec.ts`).
* Bad, because 400 KiB of minified third-party code is in the repository and updates are by hand.
* Bad, because a bug in the component is fixed by a version bump, not a patch, and the bundle can be
  read only as the packages' sources.
* Bad, because the lexing runs on the frame's main thread: a worker would take it off, at the cost of
  sending the text across on every change; the slices keep each task under one frame instead.

## More Information

Issue #444 (PG-04). ADR 0012 (plugins run from their folder), ADR 0037 and ADR 0042 (vendored
libraries), `plugins/database/ui/view-editor.js`, `scripts/vendor-codemirror.mjs`.
