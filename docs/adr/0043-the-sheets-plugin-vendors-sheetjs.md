---
status: accepted
date: 2026-11-01
decision-makers: Team endue
---

# The sheets plugin parses with SheetJS Community Edition, vendored from its release tarball

## Context and Problem Statement

`endue.sheets` opens every spreadsheet format a person meets: Excel from 2.0 to OOXML and its
binary variant, OpenDocument, Numbers, CSV and TSV, DIF, SYLK, Lotus 1-2-3 and Quattro Pro. Each
is a format of its own, and some (BIFF8, the Numbers archive, the Lotus records) are years of edge
cases. UI plugins are folders that run as they are (ADR 0012), in a sandboxed frame whose CSP
allows no eval, no network and scripts only from the plugin's folder. Where does the parser come
from, and how does it reach the plugin?

## Decision Drivers

* Every listed format opens on the first day, from one parser with one cell model
* A plugin folder runs as it is: no build step, no network, no eval
* One copy, reproducible from a pinned release, with its licence next to it, and no known advisory
* Read-only now; writing the same formats later should not need another parser

## Considered Options

* SheetJS Community Edition 0.20.3, vendored from the SheetJS CDN tarball, pinned by SHA-256
* SheetJS 0.18.5 from npm, through `package.json` and the lockfile
* A parser per family (an OOXML reader of our own, a CSV parser, libraries for BIFF and ODS)
* Converting in a sidecar process (LibreOffice headless) and reading the result

## Decision Outcome

Chosen option: "SheetJS Community Edition 0.20.3 from its tarball", because one Apache-2.0
library reads every listed format, runs in the frame without eval or network, and the copy is
reproducible.

* `scripts/vendor-sheetjs.mjs` downloads `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`,
  refuses it unless its SHA-256 is `8dc73fc3…99fe8`, and copies `xlsx.mjs`,
  `dist/cpexcel.full.mjs` (code pages for legacy files) and `LICENSE` into
  `plugins/sheets/ui/vendor/`, dropping source-map comments. `VERSIONS` records the release, the
  tarball's hash and each file's hash.
* `scripts/vendor-sheetjs.test.mjs` fails `just test-unit` when the committed copy no longer matches
  `VERSIONS`, without the network. Updating is: change the pin and hash, run the script, commit.
* SheetJS no longer publishes to npm, and 0.18.5 there carries known advisories: no
  `package.json`, no lockfile change. `ui/vendor/` is third-party as for the terminal (ADR 0037):
  biome skips it and `.gitattributes` marks it vendored.
* What Community Edition leaves out, the plugin reads itself, in its own small modules: OOXML cell
  styles from `xl/styles.xml` and frozen panes from the sheet parts (`ui/styles.js`), ODS column
  widths, row heights, hidden rows, columns and sheets and frozen panes (`ui/ods.js`). CSV and TSV
  use the plugin's own reader (`ui/csv.js`) for its encoding and delimiter rules.
* The parser runs in the frame's main thread: the sandboxed frame (opaque origin, `script-src` of
  its folder only) cannot start a worker. A large workbook holds the frame while it parses; the
  status line says "Opening …" first. Ranged reads (ADR 0041) come to this plugin later.

### Consequences

* Good, because 23 extensions open through one cell model, formulas, number formats and merges
  included, with a pure-JS ZIP and code pages and nothing to build.
* Good, because a community plugin can vendor the same way: the built-in sets the pattern.
* Bad, because 1.5 MB of third-party code is in the repository, updated by hand.
* Bad, because Community Edition keeps no styles: a second reader for OOXML styles is ours to keep.
* Bad, because parsing is synchronous: a workbook of millions of cells freezes the surface for
  seconds, and its cells cost memory in proportion.

## More Information

`plugins/sheets/README.md`, ADR 0012 (plugins run from their folder), ADR 0037 (the terminal
vendors xterm.js), ADR 0041 (ranged reads), `scripts/vendor-sheetjs.mjs`.
