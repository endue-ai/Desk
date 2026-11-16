---
status: accepted
date: 2026-11-16
decision-makers: Team endue
---

# A desk drag that carries files leaves the window for the OS, and OS text and links come in

## Context and Problem Statement

ADR 0119's broker runs every drag inside the desk: "a drag cannot leave the window" (#235's
app windows say the same, `app_windows/drags.rs`). A person dragging an Explorer entry, a viewer's
file or an image onto Finder or Mail gets nothing; the drag ends with `none` at the edge. The other
way, the OS hands the desk only files (winit's `HoveredFile`/`DroppedFile`): text and links dragged
from a browser or an editor are refused (#309). How does a desk drag reach OS apps, and OS text
reach the desk's drop targets, without giving up the broker's rules?

## Decision Drivers

* The broker stays the one place that decides a drag: the same trust boundary (`dnd/data.rs`), the
  same `drag.*` messages, the source hears how it ended
* Only files cross to the OS: the desk's other types (JSON, its own text) mean nothing there
* The OS's target decides copy, move or link, as for any app's drag; the desk moves nothing itself
* No change to winit or CEF; the motion gate stays green (ADR 0208)

## Considered Options

* Hand off at the edge: a surface's drag offering `desk/paths` whose pointer leaves the window
  becomes an OS drag session with those files
* Start an OS drag for every desk drag from the first move (every drag through AppKit)
* Keep drags inside and offer "Reveal in Finder" instead

## Decision Outcome

Chosen option: "hand off at the edge", because drags inside the desk keep the broker's speed and
rules untouched, and only the one case the person asked for (files, out of the window) changes.

* **Out.** The compositor sees the pointer of a surface's drag of paths past the viewport's edge:
  the surface under it hears `drag.leave`, nothing drops, and `Out::HandOff { paths, allowed }`
  asks the shell to start an OS drag. On macOS that is an `NSDraggingSession` from winit's view
  (one item per file URL, its Finder icon) with the operations the source allowed. Its end comes
  back as `Input::HandOffEnded`: the source hears `drag.ended` with the OS's operation and
  `to: "os"`, or `none` when it was cancelled or could not start. The OS owns the release.
* **In.** On macOS the desk window also registers for strings and URLs; winit's window delegate
  still handles files, and a drag it refuses that carries text or a URL becomes
  `Input::OsDataHovered`/`OsDataDropped`. The broker reads it as `desk/text` and `desk/uri` (with
  `text/plain`), refuses a script URI whole, and offers copy and link only.
* Windows and Linux answer a hand-off as not started (the drag ends `none`, with a log line) and
  take only files from the OS, as before.

### Consequences

* Good, because dragging a file to Finder, Mail or a browser's upload field just works, and the
  source learns whether it was copied or moved.
* Good, because text and links from any app reach the desk's drop targets under the same rules as
  desk data.
* Bad, because Windows (OLE `DoDragDrop`, `IDropTarget`) and Linux need their own follow-ups.
* Bad, because the app windows of #235 (out of the canvas, their page in CEF) do not hand off yet,
  nor take OS text; a follow-up brings them the same rules (`app_windows/drags.rs`).
* Bad, because wrapping winit's delegate methods depends on winit's selectors; a winit update must
  keep them (the wrap falls back to winit's own when a method is missing).

## More Information

Issue #309; amends ADR 0119 ("a drag cannot leave the window"); `crates/desk-compositor/src/input/
dnd/os.rs`, `router_os.rs`; `apps/desk/shell/src/os_dnd.rs`, `os_dnd/macos.rs`.
