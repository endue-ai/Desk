---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# An export goes where the save dialog says, and the plugin writes .xlsx itself

## Context and Problem Statement

PG-61 (#482) asks that `endue.database` export a result to the folder and in the format the person needs:
the desk's save dialog with the last folder suggested, a manifest write permission no wider than that, an
`.xlsx` with typed cells and one sheet per result, HTML and XML, options per format, the person's own
template, and no export to a place the person did not choose, an agent's included. Until now an export was
written into `~/Downloads`, which the manifest declared for it. Where does an export go, what grants it,
and how is an `.xlsx` written?

## Decision Drivers

* The person, never a command's argument, chooses the place; an agent cannot widen it
* The manifest declares nothing an export no longer needs
* An `.xlsx` holds numbers and dates exactly and opens without a repair; no large dependency
* A large result's file is written off the frame's thread

## Considered Options

* `dialog.save` for every export, the plugin writing the OOXML parts and their zip itself
* A `path` argument for agents, checked against a folder list
* A spreadsheet library vendored into the plugin

## Decision Outcome

Chosen option: "`dialog.save` for every export, the plugin writing the OOXML parts and their zip itself".
The save dialog grants the one path chosen (`fs:write` on it alone, for the session) and refuses any
caller but the plugin's frame, so the write needs no declaration; the command has no path argument and
its argument schema allows no other properties. The folder of the last export is kept in the plugin's
store (`export-folder`) and passed as `startIn`; each format's last options are kept beside it
(`export-options`). The `${home}/Downloads/**` declaration stays only for a cell's bytes
(`features/cell-values/`); moving those to the save dialog drops it.

The `.xlsx` is five fixed parts and one worksheet per result, cells inline (no shared strings), packed by a
zip writer of about 100 lines that deflates with the platform's `CompressionStream` (stored where there is
none) and a fixed time, so the same result makes the same bytes. A value is a number cell only with at most
15 significant digits, which every double holds exactly; else it stays text. Dates and timestamps without a
time zone from 1900-03-01 on, to the millisecond, are date cells; the rest stays text. Past 20,000 cells the
file is written in the export's worker (`ui/export/worker.js`).

### Consequences

* Good, because an export is written only where the person said, whoever asked for it
* Good, because no dependency, licence or vendor folder is added, and the writer is read back in its tests
* Bad, because every export asks the person a question, even a repeated one; the last folder and options
  make it one key press
* Bad, because the workbook is plain (no column widths, no formulas); a library would give more

### Confirmation

`plugins/database/tests/export*.test.ts`: the save dialog's call and its path alone written, an agent's
`path` ignored, each format and option, the `.xlsx` unzipped and parsed again, and on a real PostgreSQL the
CSV, TSV and INSERT read back equal to the source.
