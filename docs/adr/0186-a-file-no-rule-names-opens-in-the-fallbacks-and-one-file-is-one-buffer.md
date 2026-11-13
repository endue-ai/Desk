---
status: proposed
date: 2026-11-12
decision-makers: Team endue
---

Status: amended by ADR 0212: one file is still one buffer, and the buffer names the window of its
opener that shows it.

# A file no rule names opens in the fallbacks, one file is one buffer, and the ring holds what shows

## Context and Problem Statement

The QA pass of 2026-11-11 (#162 findings 10, 12, 13 and 14) found four ways in which opening files
on the desk did not do what `plugins/README.md` and the buffers' README say:

* A file no `contributes.files` rule names (`blob.bin`, `sample.bplist`, `README`, `Makefile`)
  opened nothing: a warning cut off at the bottom edge, "no plugin opens <path>" for the CLI and the
  Explorer. The README promises "a file a plugin cannot draw opens as its details (name, size,
  format, why)", and Notes is "the first file opener" for text.
* The buffer id was `file:` and the path as given, so `~/files/small.csv` (what the Explorer
  passes), `/Users/me/files/small.csv` (a drop from Finder) and `/private/tmp/…` (what macOS gives
  for `/tmp/…`) were three buffers of one file, each a stale copy of the others.
* A plugin's own surface (`surface:<plugin>`) was a stop of the ring beside the files the plugin
  holds: after two `Mod+W` in a Reader with three files the buffer "used before" was the surface,
  which shows nothing, so the Reader said "No document open" while it held a file; next and
  previous had a dead stop per plugin, and `Mod+B` a row for it.
* A file dragged in from the OS showed no hint of where it would go; only the drop opened it.

The desk never reads a file itself (desk.files' rule), the runtime does not know the home folder
and cannot follow a link, and the compositor, not the runtime, runs drags from the OS (#56, #83).

## Decision Drivers

* Every file a person opens shows something: the file, or why it cannot be shown
* An extensionless text file (README, Makefile, a dotfile) opens where text is edited
* One file, one buffer, whichever way it was opened
* `Mod+W`, `Mod+B`, next and previous never stop at something that shows nothing
* No new bridge method and no spec change for any of it

## Considered Options

* For a file no rule names: fallbacks in desk.files (text first for a name without an extension,
  then `desk.files.fallback`, `endue.data` by default, whose view sniffs the format and shows
  details); a question card from the desk ("No plugin opens blob.bin: Open with… · Show in
  Finder · Keep it closed"); a details view of the desk's own
* For the spelling: the shell names the file (`real_path`: the folders above it followed through
  their links, the home folder as `~`); `fs.stat` answers a canonical path (a bridge change); the
  shell and the CLI translate only the OS's paths; the runtime normalizes lexically only
* For the ring: a plugin's surface is a stop only while the plugin holds no buffer of its own;
  drop the surface entries altogether
* For the hover: the compositor draws a caption under the OS's own file image; the runtime draws
  a hint above the windows from an event the compositor sends it

## Decision Outcome

Chosen: fallbacks in desk.files, the shell's `real_path`, a surface that stands for the buffer it
shows, and the compositor's caption, because each closes its finding inside the layer that already
holds what it needs, with no new bridge method.

* **Fallbacks** (`packages/runtime/src/policies/files-open.ts`, Emacs's `fundamental-mode`): a file
  no rule names opens, in turn, in the plugin `.txt` files open with when its name has no extension
  (a dot after the first character; `.zshrc` has none), then in `desk.files.fallback` (a new
  setting of `plugins/files`, default `endue.data`: it reads the format from the first bytes, so a
  binary plist opens as a tree, and shows name, size, format and why for bytes it cannot show). A
  try that fails moves on without a notice; only the last failure says so. An empty or uninstalled
  fallback refuses the file as before.
* **One spelling** (`files.ts`, `apps/desk/shell/src/real_path.rs`): before a buffer is named its
  path is made one spelling (`${home}` as `~`, empty, `.` and `..` segments, no trailing slash) and
  the desk's page asks the shell's `real_path` (main window only, nothing read): the folders above
  the file followed through their links, the home folder as `~`. The file itself is not followed,
  so a link keeps its own name; a path the OS cannot follow is kept as given.
* **The ring** (`packages/runtime/src/policies/buffers.ts`): a plugin's surface is a stop only
  while the plugin holds no buffer of its own; while it does, it stands for the buffer it shows.
  `Mod+W` without an id, what shows after a close, the focus and a switch to the surface use that
  buffer; next, previous and `Mod+B` leave the surface out. A surface named by its id still closes
  with the plugin's buffers, and `desk.buffers.list` still lists every buffer.
* **The hover** (`crates/desk-compositor/src/input/dnd/broker.rs`, the shell's `overlay.rs`): the
  OS still draws the files' image and its copy cursor (winit answers every file drag with copy);
  the compositor draws its drag pill beside it: "+ name" (or "↗ name") over a surface that takes
  the files with that effect, "Open name" anywhere a drop opens them on the desk. Near the window's
  right or bottom edge the pill, for every drag, goes to the other side of the pointer.

### Consequences

* Good, because every file opens to something, and `README` or `Makefile` opens in Notes.
* Good, because the Explorer, a drop, Finder's Open With and an agent's absolute path name one
  buffer for one file, and the recent files and the session keep that one name.
* Good, because the ring never stops at a surface beside its files, without a change to the list.
* Bad, because a binary file without an extension goes to the text opener first: its window comes
  up with its own refusal on its status line before the fallback shows the details.
* Bad, because the fallback reads a whole file to show its details; a very large unknown file is
  read with progress and Cancel before it says what it is.
* Bad, because the hover names no plugin: "Open budget.xlsx", not "Opens in Sheets". The rules live
  in the runtime; naming the opener there needs the runtime to tell the compositor, a later change.
* Bad, because `Mod+W` on a plugin's surface while the plugin holds files closes the file it shows,
  not the window: ADR 0177's "Mod+W on a plugin's own surface asks about the plugin's buffers that
  go with it" now holds for `desk.buffers.close` with the surface's id and for the window's ×.

## More Information

Issue #162 (QA pass 2026-11-11, work order C24). Amends ADR 0177 (`Mod+W` on a plugin's surface)
and ADR 0119 (an OS drag now has a caption). Code: `packages/runtime/src/policies/{files,
files-open,buffers}.ts`, `plugins/files/plugin.json`, `apps/desk/shell/src/real_path.rs`,
`apps/desk/shell/src/commands.rs`, `crates/desk-web/src/sender.rs`, `apps/desk/src/native-files.ts`,
`crates/desk-compositor/src/input/dnd/broker.rs`, `apps/desk/shell/src/compositor_window/overlay.rs`.
Tests: `packages/runtime/src/policies/{files-fallback,buffers-ring}.test.ts`,
`apps/desk/shell/src/real_path.rs`, `crates/desk-compositor/tests/input_dnd.rs`,
`packages/runtime/e2e/files.spec.ts`. No section of `docs/ko/desk-structure.md` changes.
