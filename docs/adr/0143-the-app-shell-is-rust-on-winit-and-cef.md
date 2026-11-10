---
status: accepted
date: 2026-11-10
decision-makers: Team endue
---

# The app shell is a Rust binary on winit and CEF, without Tauri

## Context and Problem Statement

ADR 0140 replaces the OS webviews with CEF. Tauri's three distinctive parts, the wry webview,
`#[tauri::command]` IPC and per-webview capabilities, have no role once plugins are CEF surfaces and
the screen is drawn with wgpu. What remains (a window and its event loop, tray, menus, global
shortcuts, dialogs, a single instance, the bundler, the updater) exists as standalone crates, most
of them from the Tauri team. Tauri's experimental CEF runtime fights its bundler over the helper app
bundles CEF needs on macOS. `apps/desk/src-tauri` is about 4,500 lines, and none of the core crates
depend on Tauri. Where does the new shell live, how is CEF driven, what replaces each part of Tauri,
and how do day-to-day commands avoid building CEF?

## Decision Drivers

* `just check`, `just test` and the default workspace never download or build CEF
* One event loop for windows, input, wgpu and CEF, at full frame rate on macOS
* Every Tauri feature the desk uses has a replacement before Tauri goes
* Logic that does not need the engine is tested without it
* Bundles carry CEF's helper apps, signed and notarised in the same job

## Considered Options

* A Rust binary on winit and CEF with standalone crates, and the engine-independent logic in a crate
  of its own
* Tauri with its experimental CEF runtime
* The same binary on tao (Tauri's windowing crate) instead of winit
* One crate under `apps/` holding the binary and all its logic

## Decision Outcome

Chosen option: "a Rust binary on winit and CEF with standalone crates", because it carries no unused
webview runtime, its bundler knows CEF's helpers, winit is what wgpu and AccessKit integrate with
first, and splitting the engine-independent logic out keeps CEF out of the default build.

* **`apps/desk/shell`** is the shell: a Rust binary crate. `apps/desk` keeps the web frontend it
  serves (today's shell page, built with Vite). The crate is a workspace member but not a default
  member: it downloads and builds CEF, as the Tauri crate needs the platform webview SDKs, so
  `just check-shell` and the `shell-build` CI job cover it, and `just dev-shell` runs it.
* **`crates/desk-web`** holds what does not need the engine: the `desk-app` scheme's shell files,
  the `desk-plugin` scheme's request → response (plugin files, `fs.url` ranges, preflights, the
  SDK), the CSP, parsing a surface's origin, and the caller's identity taken from a frame's origin.
  It is a default member, so `just test` runs its tests; the CEF handlers in the shell are thin
  adapters over it.
* **`crates/desk-compositor`** and **`crates/desk-surface`** follow in Stage 2 (ADR 0140, ADR 0141).
* **The pump**: CEF runs with an external message pump driven from `OnScheduleMessagePumpWork` inside
  winit's event loop. CEF names a delay, the shell wakes the loop at that time through an event-loop
  proxy (at most 33 ms apart) and calls `do_message_loop_work` once. The PoC showed that calling it
  when CEF did not ask blocks about 60 ms per call on macOS (13 fps); the schedule gives 57–59 fps.

| Tauri gave | Replaced by |
| --- | --- |
| the wry webview, `#[tauri::command]` IPC, capabilities | CEF; the bridge over CEF process messages (#43); permissions are the core's already |
| tao's window and event loop | winit |
| the tray, menu, global-shortcut and dialog plugins | `tray-icon`, `muda`, `global-hotkey`, `rfd` |
| the single-instance plugin | the same behaviour without Tauri (#45) |
| the bundler | `cargo-packager`, with CEF's helper apps on macOS and `libcef` on Windows and Linux |
| the updater plugin | `desk-update` as it is, with a new `Installer` for the new bundle (#47) |
| `macos-private-api` (transparency, the Eris window) | winit and objc2 |

* The Tauri crate (`apps/desk/src-tauri`) is deleted when Stage 1 ends. Until then both apps build
  side by side, so M1 ships on Tauri as planned.
* Update (2026-11-10, #97): Stage 1 ended. `apps/desk/src-tauri`, the vendored single-instance plugin,
  the `check-app`, `build-app` and `bundle-app` recipes, the `app-build` and `app-e2e-tauri` jobs and
  the bridge's Tauri adapter are deleted, and the icons moved to `apps/desk/shell/icons`. The shell's
  binary is `endue-desk`, the Tauri desk's name, with its helper apps `endue-desk Helper…`, so a Tauri
  install's shortcuts, start at login and restart find it after the update; `just dev` runs it, and
  `dev-shell` stays as an alias. `.github/release-shell` says `cef`, so canary builds the CEF desk and
  `release-build.yml` builds no other. `@tauri-apps/cli` stays in `apps/desk` only as the updater's
  signer (`tauri signer`). The shell's build (`shell-build`) runs on three OSes for app changes and
  release pull requests, and joins the required `ci` checks once it has run green on all three.

### Consequences

* Good, because the default workspace never builds CEF, and the scheme and caller logic is tested in
  `just test`.
* Good, because nothing in the shell is unused, and the bundler handles CEF's helper bundles.
* Good, because the event loop is winit's, which wgpu, AccessKit and IME events already use.
* Bad, because the window, tray, menu and dialog glue that Tauri gave for free is ours to keep on
  three OSes.
* Bad, because CEF is a large download and build; the app crate's checks are slower than the Tauri
  crate's, and the download is cached under `target/`.
* Bad, because macOS needs five helper bundles signed with the hardened runtime and notarised.
* Bad, because two apps exist side by side for the length of Stage 1.

## More Information

Epic #32 §7 (the shell without Tauri) and §1 (processes); issues #41 (the shell), #42 (`desk-web`
and the scheme), #43 (the bridge), #45 (tray, menus, windows), #46 (packaging), #47 (the updater).
PoC finding 1 in `spikes/compositor/README.md` (the macOS pump). ADR 0140 supersedes ADR 0001 (Tauri
over Electron); this page is how its shell is built.
