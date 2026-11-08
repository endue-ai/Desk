---
status: accepted
date: 2026-10-27
decision-makers: Team endue
---

# Use Tauri 2 as the shell instead of Electron

## Context and Problem Statement

Desk needs a desktop shell that hosts a web runtime and gives a Rust core access to windows, webviews and
OS primitives on macOS, Windows and Linux. The Rust core does heavy, long-running work (audio capture,
PTYs, file watching, a VM supervisor), and the app stays resident all day. Which shell should carry it?

## Decision Drivers

* Small download and low resident memory for an app that is always open
* The Rust core in the same process as the shell, without an IPC hop to a separate native helper
* Per-window and per-webview permissions that match the bridge's deny-by-default model
* A way out if one OS webview turns out to be unworkable

## Considered Options

* Tauri 2 (OS webview + Rust)
* Electron (bundled Chromium + Node)
* CEF with a custom native shell

## Decision Outcome

Chosen option: "Tauri 2", because it keeps the app small and light, runs the Rust core in-process, and
its capability system lines up with the bridge permission model. The risk sits in the webviews, which
differ per OS, so the bridge is the seam that lets us swap the shell for Electron or CEF later by
reimplementing only the bridge.

### Consequences

* Good, because the installer and idle memory stay small, and one Rust crate set can be reused by any
  future shell.
* Good, because shell permissions are declared per window and webview in `capabilities/`.
* Bad, because WKWebView, WebView2 and WebKitGTK behave differently, and WebKitGTK on Linux is the weakest.
  We develop against Safari, ship Linux in 2D mode first, ban Chromium-only APIs, and run per-engine
  visual regression tests.
* Bad, because Rust changes mean recompiling, signing and notarising. The core stays small and features
  move into plugins.

### Confirmation

The bridge stays the only path from the runtime to native code (`specs/bridge`), so a shell swap remains
a bridge reimplementation. Reviews reject runtime code that calls Tauri APIs directly.

## Pros and Cons of the Options

### Tauri 2

* Good, because the app is small and the Rust core shares the process.
* Good, because capabilities give window- and webview-level permissions.
* Bad, because the webview engine differs on every OS.

### Electron

* Good, because Chromium is identical everywhere.
* Bad, because every install ships Chromium and Node, and resident memory is high.
* Bad, because the Rust core would live behind an extra native module or process boundary.

### CEF with a custom shell

* Good, because Chromium is identical everywhere and the shell is fully ours.
* Bad, because we would maintain a native shell on three OSes ourselves.

## More Information

Design: `docs/ko/desk-structure.md`, section "기술 스택 장단점" (stack trade-offs). Revisit if every OS
must run Chromium-only features.
