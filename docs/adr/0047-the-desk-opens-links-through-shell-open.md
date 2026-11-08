---
status: accepted
date: 2026-11-01
decision-makers: Team endue
---

# The desk opens links through shell.open, a bridge method under a narrow permission

## Context and Problem Statement

Plugin frames are sandboxed with an opaque origin and a CSP that blocks the network (ADR 0041), and
they cannot open popups, so a link in a plugin goes nowhere: `endue.web` can only show a link's
address, and `desk.views.open-original` failed "until shell.open is served". The file plugins will
want the same for links in documents and for "show in Finder" (#189, #196). How does a plugin hand a
link to the system's browser or mail app, or show a file in the file manager, without being able to
start anything else?

## Decision Drivers

* Deny by default: a plugin reaches the system only through the core's grant check (ADR 0029)
* A link must never run something: no `file:`, `javascript:`, `data:` or custom schemes, no shell
* A file is shown, never opened: opening one in its default app can run it (`.command`, `.app`,
  `.exe`)
* The same rules in the app, the browser stub and every OS (macOS, Linux, Windows)
* Additive to bridge v0 (ADR 0004); no new crate when a few lines of `desk-sys` will do

## Considered Options

* `shell.open`, a bridge method under a new `shell:open` permission, opened by `desk-sys`
* Tauri's opener plugin, with a capability the plugin frames could reach
* Let frames open popups (`allow-popups`) and leave links to the webview
* `proc.spawn` of `open` or `xdg-open` under a `proc:spawn` grant

## Decision Outcome

Chosen option: "`shell.open` under `shell:open`", because the core then checks the scheme and the
grant on every call, the person sees a request in words ("Open links (https, mailto) in your
browser", "Show files in Finder"), and the frames keep no capability of their own.

* `shell.open { target, reveal?, scope }` answers `{ opened: true }`. `ShellOpenPermission` carries
  `schemes` (only `http`, `https` and `mailto` exist in `ShellScheme`, so a scope narrows them and
  never widens them) and `paths` for reveals, at least one of the two.
* `desk_sys::shell::link` parses the URL (WHATWG) and refuses everything else with `invalid_params`,
  control characters included, before any grant is looked at. The URL goes to the OS as one
  argument: `open`, `xdg-open`, `ShellExecuteW`. A reveal is `open -R`, FileManager1's `ShowItems`
  (the folder through `xdg-open` without it), `explorer /select,`; a path is never opened.
* shell.open is the one call that asks by itself: without a grant covering its scope the core asks
  the person through `perm.prompt`, as `perm.request` does, and then opens.
* `Core::with_opener` replaces the system's opener, so tests launch nothing; the browser stub records
  every call it lets through, and the dev page hands links to `window.open`.

### Consequences

* Good, because one rule set serves every caller: the stub refuses what the core refuses, and the
  later file plugins only name `shell:open` in their manifests.
* Good, because a granted `https` link cannot become a `file:` or script URL, and a revealed file is
  never run.
* Bad, because the core asks by itself for this call only, a second way to reach `perm.prompt`.
* Bad, because the OS decides what happens to an `https` URL: a person whose default browser handler
  is something else gets that. `mailto` is assumed to be harmless.
* Bad, because Linux reveals depend on a file manager that serves FileManager1; without one only the
  folder opens, with nothing selected.

## More Information

Issue #179; `specs/bridge/v0/README.md` (shell.open), `specs/plugin/v0/README.md` (`shell:open`);
`crates/desk-sys/src/shell.rs`, `crates/desk-core/src/core_shell.rs`,
`packages/bridge/src/stub-shell.ts`. `docs/ko/desk-structure.md` (the bridge and the permission
vocabulary) should list `shell.open` and `shell:open`.
