---
status: proposed
date: 2026-11-12
decision-makers: Team endue
---

# An extraction asks one question; a folder Archives may not read is written as the desk writes

## Context and Problem Statement

Archives extracts to a folder the person picks in the palette, after `perm.request` for `fs:write` on
it, and asks once for the run when a file of the same name is already there (overwrite, skip or
stop). To know which files are there it lists the folder, which takes `fs:read`: a grant that
`fs:write` does not imply (the core's `covers`). Inside the archive's own folder the read grant the
desk gave when the person opened the archive (ADR 0131) covers that; anywhere else Archives asked a
second time, "Read files <folder>/** · To see which files already exist", before it wrote anything
(#162 finding 15). The README promised one question, and a person who answered the first one thought
the extraction under way. Separately, "Allow once" grants one call (`once` in `perm.schema.json`: the
next call it allows): an extraction of more than one file stopped with "Not allowed to write" after
the first. How does an
extraction ask once and finish, without putting a person's file out of reach?

## Decision Drivers

* One act, one question: the person decides once where the files go
* No file the person had is lost without a way back
* The bridge contract unchanged: `perm.request` asks for one permission, `fs.write` has no "only if
  new" flag, and the probes that could tell (`fs.mkdir`, `fs.rename`) put entries on the desk's one
  undo stack
* An answer means what it says: "Allow once" is one call

## Considered Options

* Ask only for `fs:write`; find the files already there under the read grants Archives holds; in a
  folder it may not read, write as `fs.write` writes, which keeps what each write replaces (ADR 0076),
  and name the replaced files at the end
* Keep the second question, asked only where the folder cannot be read (as before)
* Probe the folder with `fs.mkdir` under the write grant: a folder it creates held nothing
* Ask for `fs:read` and `fs:write` together, which needs a spec change to `perm.request`

## Decision Outcome

Chosen option: "ask only for `fs:write`", because the folder beside the archive (the default) is read
under the grant Archives already holds, so the overwrite question stays where it matters most, and a
folder elsewhere is usually new; where it is not, the desk's history keeps every file a write
replaced (`desk.files.history-max-versions`, 50 by default), Undo restores the last, and the status
line names each one ("Replaced 1 file that was already there: notes.txt; the desk keeps what it held
in its history"). The second question is what the finding reports; the `fs.mkdir` probe puts an entry
on the desk's undo stack that Undo refuses once the folder holds files ("not an empty folder any
more"), in front of the person's own steps; a combined question changes the spec.

* **The one question** is `fs:write` over the folder. The files already there are listed with
  `fs.list` under the read scope of the folder, which any read grant Archives holds over it answers;
  a folder that does not exist yet is listed once, not folder by folder; a denied listing is not
  asked for.
* **"Allow once"** writes one file. An extraction with more to write writes nothing, gives the grant
  back (`perm.revoke`) and says why: extract again and allow it for this session.

### Consequences

* Good, because every extraction asks one permission question, and the extraction the person allowed
  finishes.
* Good, because nothing of the person's is out of reach: a replaced file is in its history and named.
* Bad, because outside the folders Archives may read, "Skip existing files" is not offered: a file of
  the same name is replaced. Where history is off (`history-max-versions` 0), it is gone.
* Bad, because "Allow once" on an extraction of several files is a dead end the person has to answer
  again; the card itself still offers it.

## More Information

Issue #162, finding 15 (QA pass of 2026-11-11). Code: `plugins/archives/ui/{extract,existing,files}.js`.
Tests: `plugins/archives/tests/extract-ask.test.ts`, `plugins/archives/tests/extract.test.ts`.
