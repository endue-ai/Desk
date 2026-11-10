---
status: accepted
date: 2026-10-27
decision-makers: Team endue
---

Status: amended by ADR 0140: every surface gets an origin of its own, the scheme has one form on every
OS once CEF serves it, and the `sandbox` attribute ends with the iframes in Stage 2. Amended by ADR 0160: a plugin document
asked for as a frame of the desk's own page is refused; every plugin page is a browser of its own, and
the runtime still tells plugins apart by the source of a message, each surface's port.

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

A reload waits up to 500 ms for the frame's answer to a ping before it loads the new revision
(`packages/runtime/src/frames/reload.ts`, #32): the state the plugin set just before then reaches the
desk from the frame's own window. Chromium hands a message from a page that has gone no `source`, and
the runtime still never takes such a message as any plugin's. From the update on, what needs the
plugin's answer (a request, a command invocation, a permission prompt, an approval) waits for the new
page's hello, as on a first load, and what the page it left was asked and never answered is cancelled
at that hello (#142): the frame's window stays the same across the reload, so the plugin host ends the
greeting itself rather than post to a page that cannot hear.
