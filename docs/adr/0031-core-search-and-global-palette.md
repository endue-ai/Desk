# 0031. Core-owned search documents and an OS-level palette

Date: 2026-11-01

Status: Accepted

## Context

The command palette can list commands, but people also need to find plugin data, launch plugins,
and find files and applications while another application has focus. Plugin stores are private;
search must not implicitly expose credentials or implementation state from those stores.

## Decision

Add four bridge primitives. `search.replace` atomically replaces the installed caller's explicitly
published documents, with a per-plugin size budget. `search.query` reads those documents and UI
plugin launchers under `search:read`. Disabled plugins' documents are excluded. `search.system`
queries the host index under `search:system`; `search.open` accepts only a short-lived result id issued
to that caller. Native paths are not accepted as open requests. Source processes have time and output
bounds, and search runs outside the UI thread.

The existing `desk.palette` plugin remains the search/picker UI. A separate Tauri window hosts that
same sandboxed UI above other applications, embedded in the binary so installed plugins cannot
impersonate the privileged native palette. It forwards calls under a fixed native-palette identity;
it does not mount another runtime or register duplicate plugin commands. The main runtime remains
alive when its window closes, and its registry handles plugin launch and document actions. Tray
Search/Open/Quit actions keep the app reachable if shortcut registration fails.

Plugins publish through `ctx.search.replace` and register their own document-open command. Notes
publishes open documents; Eris publishes recent completed exchanges. Opening an Eris result does
not send a new brain turn. Private settings and arbitrary plugin storage are never indexed.

## Consequences

The palette works across Desk profiles and while the main window is hidden. macOS uses Spotlight,
Windows uses Windows Search, and Linux requires a populated `locate` database. Search coverage
follows each OS index and its privacy settings. A missing index is reported while other sources
continue to work. Default shortcuts preserve the OS's existing Spotlight binding.

A plugin must explicitly publish searchable records and keep them current or clear them. The core
persists the index, limits it to 500 documents / 4 MiB per plugin, and omits records when the plugin is
disabled. Unindexed data is intentionally absent. The SDK and native shell use the same public bridge
contracts, generated from `specs/`.
