---
status: accepted
date: 2026-11-27
decision-makers: Team endue
---

# Image Studio runs edits in WebAssembly

## Context and Problem Statement

Image Studio needs the same pixel operations for the web surface and for agent commands. An edit
must preview before it touches the file system. Desk already serves WebAssembly assets and supports
workers in isolated UI plugins.

## Considered Options

- Move editing to a native plugin that Desk launches for each supported OS.
- Edit raster pixels in a Rust WebAssembly module inside a standard UI plugin.

## Decision Outcome

Image Studio decodes supported stills in its worker and sends RGBA pixels to Rust. The Rust module
applies ordered edit batches, manages undo and redo, renders previews and encodes PNG. Agent commands
target a document ID and revision. The editor restores drafts by replaying their operations against
the same source bytes. The person chooses the export path through Desk's save dialog.

### Consequences

- One built-in UI plugin runs on each desktop platform without a native binary or new bridge methods.
- Bounded raster sizes and history keep the worker's memory predictable. Codec support comes from the
  renderer for input and the Rust encoder for output.
