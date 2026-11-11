---
status: proposed
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0070 (what an opener keeps when its window sleeps, and its consequence that Notes'
unsaved text beyond 64 KiB comes back from disk).

# File openers keep their files and unsaved edits across a sleep, within 64 KiB

## Context and Problem Statement

A window out of sight sleeps (ADR 0070, ADR 0134): the desk asks its frame for the state to keep
(`ui.surface.state`, JSON up to 64 KiB) and takes the frame away. The QA pass of 2026-11-11 (#162)
found every file opener coming back empty: Reader, Docs, Slides, Sheets, Data, Player, Web and
Archives keep nothing, so they wake on "No document open" while the desk still lists their files,
and a switch to one, or opening the same file again, fails with "No file …" until the window is
closed. Notes keeps its notes, but with the whole text of every unsaved note: once a 114 KB note was
edited the state passed 64 KiB, the SDK refused to send it, and the desk kept nothing at all: both
notes and their unsaved text were gone while the desk still marked them unsaved. How does an opener
come back with its files, the place in each and its unsaved edits, and what does it do with edits
that do not fit?

## Decision Drivers

* Unsaved edits are the person's work; a sleep is the desk's choice, not theirs
* A buffer the desk lists can always be shown and opened again
* No change to the bridge contract (`specs/bridge/v0`: 64 KiB, an oversized state comes back cold)
* Nine openers adopt one helper rather than each packing its own state

## Considered Options

* An SDK helper, `keepFiles`, that fits an opener's files, places and edits into the 64 KiB, with a
  text edit kept as its change from the saved text; an opener opens a listed buffer it lost on show
* Raise the bound, to a few MiB, for every plugin's `ui.surface.state`
* Keep a window awake while its unsaved edits do not fit
* Put unsaved text in the plugin's `desk:state`, which has no bound

## Decision Outcome

Chosen option: "an SDK helper", because typing in a large file is a few bytes as a change, so the
edits a person makes fit the bound as it is, and the files always fit, which alone ends "No document
open"; the other options change what the spec promises or work around its bound.

* **`keepFiles(ctx.surface, { files, shown, readPlace?, readEdit? })`**
  (`packages/plugin-sdk/src/open-files.ts`) answers `ui.surface.state` with `{ v: 1, files, shown }`:
  each open file's buffer, path, `place` (a page and zoom, a caret and scroll, its watch) and `edit`.
  An opener gives a file's edits best form first (the whole text, then its change); `fitFiles` takes
  the best that fits and, past 64 KiB, gives up from the file used longest ago up, the one on screen
  last: smaller forms, then edits (the file is kept, `lost: true`), then places, then files.
* **Back**, the opener takes each kept file as it opens it again; until then the helper keeps it, so
  a frame that sleeps again first loses nothing. It opens without asking for a folder or taking the
  focus: Notes reopens every note, Reader the file on screen (the others when shown).
* **Text changes** (`textChange`, `applyTextChange`, `text-change.ts`): one splice and a fingerprint
  of the saved text; applied only to that text, so a file changed on disk meanwhile refuses it.
* **A listed buffer the frame lost** (a crash, a page loaded again, a state not kept) opens from disk
  on `desk.buffers.show`, unless the frame closed it itself; a lost edit clears the desk's unsaved
  mark (`desk.buffers.update`) and says so on the status line.
* Notes and Reader first; Docs, Sheets, Slides, Web, Data, Archives, Player and Images follow.

### Consequences

* Good, because a window that slept shows the same files at the same place, with typed edits, and a
  file the desk lists can always be opened again.
* Good, because the bound and the bridge contract stay as they are, and old plugins still come back
  cold.
* Bad, because an unsaved change itself bigger than about 64 KiB (a large paste, a replace-all) still
  does not fit: the file comes back as saved on disk and the person is told. Raising the bound or
  keeping such a window awake would close that, and both change the spec.
* Bad, because a change kept for a file that changed on disk while its window slept cannot be put
  back; the whole text is kept instead whenever it fits.
* Bad, because a kept password is not wanted, so a locked PDF asks for it again after a sleep.

## More Information

Issue #162, finding 1 (QA pass of 2026-11-11). Amends ADR 0070. Code:
`packages/plugin-sdk/src/{open-files,text-change}.ts`, `plugins/notes/ui/{keep,notes,grants,search}.js`,
`plugins/reader/ui/{keep,reader,loading}.js`. Tests: `packages/plugin-sdk/src/{open-files,text-change}.test.ts`,
`plugins/notes/tests/unload.test.ts`, `plugins/reader/tests/unload.test.ts`, the app e2e
`e2e/specs/sleep-openers.spec.ts` (Notes). No section of `docs/ko/desk-structure.md` changes.
