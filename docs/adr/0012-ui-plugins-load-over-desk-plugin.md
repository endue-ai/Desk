---
status: accepted
date: 2026-10-27
decision-makers: Team endue
---

# UI plugins load over a desk-plugin URL scheme, sandboxed, with the SDK from an import map

## Context and Problem Statement

UI plugins are folders of HTML, JS and CSS that must load into the desk, reload alone when their files
change, and reach nothing except through the bridge. How are their files served, how do they get the
SDK, and how does the core know which plugin is calling?

## Decision Drivers

* Plugins must not reach the desk's page, Tauri's IPC, or the network on their own
* A plugin folder needs no build step to run (`examples/` must run with one command)
* Hot reload within a second, of one surface only
* The same mechanism in development and in release builds

## Considered Options

* A `desk-plugin` URI scheme served by the core; sandboxed frames; SDK via an import map
* Serving plugins from the Vite dev server and bundling them into the app
* Plugins bundle the SDK themselves with their own build step

## Decision Outcome

Chosen option: "a desk-plugin URI scheme", because the core already owns the plugin registry and its
path checks, so serving files from it keeps one source of truth in development and release.

* Frames get `sandbox="allow-scripts"` only: an opaque origin, no forms, popups or navigation. HTML
  responses carry a CSP with `connect-src 'none'`, so the network is reachable only through
  `net.fetch` and its permission check. Tauri IPC is not exposed to these origins.
* The runtime tells plugins apart by the frame a `postMessage` comes from and passes that plugin's id
  as the caller, so a plugin can only ever call as itself.
* Desk serves one bundled SDK at `/_desk/plugin-sdk.js` (embedded in the binary); plugins import
  `@endue-ai/plugin-sdk` through an import map, so plain JS plugins need no build.
* A file watcher (100 ms debounce) bumps the plugin's revision and emits `plugin.changed`; the
  runtime reloads that frame with `?v=<revision>` and hands back the state the plugin saved.

### Consequences

* Good, because a plugin folder runs as-is and reloads in well under a second.
* Good, because the permission boundary is the bridge alone.
* Bad, because the SDK must be built before the app (`just build-sdk`, run by the app recipes).
* Bad, because the per-OS URL differs (`desk-plugin://localhost` vs `http://desk-plugin.localhost`).

## More Information

`apps/desk/src-tauri/src/protocol.rs`, `packages/runtime/src/plugins.ts`, `packages/plugin-sdk`,
`crates/desk-core/src/watch.rs`. Issue #10.
