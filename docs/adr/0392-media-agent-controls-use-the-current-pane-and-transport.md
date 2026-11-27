---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Media agent controls use the current pane and transport

## Context and Problem Statement

Images opens per-file panes that share one command provider. Player can use the webview, a
remuxer or a software decoder for the same transport. EP-25 (#741) needs agent commands for
the visible image and the actual media engine, even when an Images window has multiple tabs.
A person-selected playlist can already hand local entry folders to Player through EP-05.

## Decision Drivers

- Address an Images pane exactly and retain the in-use pane as the default.
- Use the same view, file walk, comparison, transport and playlist paths as the controls.
- Keep image transforms local to the view and rely on the existing media read grants.

## Considered Options

- Address Images by the outer window and mirror Player's state in an agent controller.
- Address Images by the pane view and query the existing media transport.

## Decision Outcome

Images accepts the `panes[].view` shown by `desk.windows.list` as its optional `window`. That
identifier distinguishes tabs in the same outer window. A missing named pane receives a
failure. Omission uses the normal in-use instance. Details show dimensions, EXIF, folder
position and view transforms. Comparison reads an already granted file, and a later choice
wins if two comparisons overlap.

Player reads the current media clock, play state and displayed title, and reports the current
file's tags, subtitle choices and playlist position. Agent and keyboard controls share the
transport and playlist operations. Playlist entries use the grant that comes from the person's
file choice (ADR 0374). Missing, remote or unreadable entries stay out of playback without new
permission cards. An explicit entry number selects that row only.

The file-manager reveal button requests the immediate folder's children and hands the system
the exact file. A top-level absolute or drive-root file requests only that file. The reveal
button stays with the person because it opens another application.

## Consequences

- Window and playback reads use the same state the view uses.
- Remembered reveal grants can cover another file in the same folder without covering its
  subfolders.
- Fixture tests observe permission requests and transport behavior with stand-ins for the
  file manager and the media engine.

## More Information

ADR 0212 (per-file windows), ADR 0374 (file choices), and issue #741.
