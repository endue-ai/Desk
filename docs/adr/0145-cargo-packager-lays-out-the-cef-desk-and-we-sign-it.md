---
status: accepted
date: 2026-11-10
decision-makers: Team endue
---

# cargo-packager lays out the CEF desk's bundles; the desk signs its helpers itself and pins CEF by hash

## Context and Problem Statement

ADR 0143 names `cargo-packager` as the CEF desk's bundler. On macOS CEF needs its framework and five
helper apps in `Contents/Frameworks`, each signed under the hardened runtime with the entitlements its
process needs; on Windows and Linux its libraries and resources sit beside the executable. Releases
come from release lines (ADR 0092) in the artifact shape the updater reads (ADR 0054), and both desks
build side by side until Stage 1 of #32 ends. Who lays out, who signs, where does CEF come from, and
which desk does a release line build?

## Decision Drivers

* The bundle is configured by us, not inferred: the "broken bundle" of Tauri's CEF runtime is the helper layout
* Every helper gets the least entitlements its process needs, and the bundle passes `codesign --deep --strict`
* CEF's bytes are the ones we reviewed: exact version, hash-checked, cached without trusting the cache
* A line builds one desk for its candidates and its final; M1's line ships the Tauri desk

## Considered Options

* cargo-packager for every format, with signing done by our script; CEF fetched by our pinned script
* cargo-packager signing too (one `entitlements` file, `signingIdentity`)
* The `cef` crate's `bundle-cef-app` (macOS only, the dev bundle `just build-shell` makes) for releases

## Decision Outcome

Chosen option: "cargo-packager for every format, signing by our script", because cargo-packager lays
out every format we ship (`.app`, `.dmg`, NSIS, MSI, `.deb`, AppImage) from one config, while its
macOS signing gives every Mach-O one entitlements file and never seals the helper apps as bundles, so
the deep check fails; `bundle-cef-app` makes macOS dev bundles only, with every helper on the main
app's identifier.

* **Layout.** `apps/desk/shell/packager/` holds what all targets share; `scripts/cef-package.mjs`
  writes the config per target. macOS: the framework and five helper apps (`endue-desk-cef Helper`,
  `(Alerts)`, `(GPU)`, `(Plugin)`, `(Renderer)`, each its own identifier `ai.endue.desk.helper[.x]`)
  are `macos.frameworks`; Windows: CEF's files beside `endue-desk-cef.exe`; Linux: the executable and
  CEF's files in `/usr/lib/endue-desk-cef` (`$ORIGIN` rpath, `libcef.so` stripped) and a launcher in
  `/usr/bin`. No `licenseFile` (it becomes a licence to accept); the licences ship under `licenses/`.
* **Signing.** `scripts/cef-sign-macos.sh` signs inside out (framework libraries, framework, helpers,
  app) with `--options runtime --timestamp`, as cargo-packager's `beforeEachPackageCommand` before the
  `.dmg`, then notarises and staples the app and the `.dmg`. Entitlements: the app
  `allow-unsigned-executable-memory` (wasmtime's Cranelift maps code without `MAP_JIT`; without it the
  hardened runtime kills the process, `allow-jit` alone too), `device.audio-input`, `device.camera`,
  `personal-information.calendars`; Renderer, GPU and the base Helper `allow-jit` (V8, SwiftShader;
  CEF 156 starts the GPU process from the base Helper, in Chromium's sandbox or not, ADR 0148);
  Alerts and Plugin none, since no
  Pepper plugin exists. An ad-hoc build alone adds `disable-library-validation`: ad-hoc code has no Team
  ID, so library validation would refuse the framework. Windows signs every unsigned PE file through
  `DESK_WINDOWS_SIGN_COMMAND`.
* **CEF.** `apps/desk/shell/packager/cef.json` pins the version and each target's minimal archive
  (size, the CDN's SHA-1, our SHA-256); `scripts/cef-fetch.mjs` refuses anything else and unpacks it
  where `cef-dll-sys` reads `CEF_PATH`. CI caches the archive only and checks it every run.
* **Which desk.** `release-build.yml` takes `shell` (`tauri` default, `cef`). A line builds what
  `.github/release-shell` names at its commit; the final reads it at the candidate's commit. It says
  `tauri`: switching is one reviewed commit on `main` once #47 can update a Tauri desk into this one,
  and the next line carries it to beta, then stable. Canary stays on Tauri until Stage 1 ends.
* **Shape.** The same canonical names (`scripts/release-collect.mjs`), updater artifacts signed with
  `tauri signer sign --app-version`; the CEF desk adds an `.msi` (a first-install image like the
  `.dmg`) and has no `.rpm` (cargo-packager makes none).

### Consequences

* Good, because every helper's entitlements are reviewed in one folder and the deep check proves the seal.
* Good, because the CEF bytes are fixed by the repository, and a bump is one reviewed change of `cef.json`.
* Good, because the switch to the CEF desk is a line-by-line decision, and M1's line ships Tauri as planned.
* Bad, because signing, notarising and the Windows and Linux paths are proven only on a machine with the
  identities and those OSes (#61); this page records the entitlement set they must confirm.
* Bad, because a desk installed from a Tauri `.rpm` gets no CEF update, and the main executable keeps its
  Stage 1 name `endue-desk-cef` beside the Tauri desk's `endue-desk` (#47's transition).
* Bad, because only the macOS desk runs in Chromium's sandbox (ADR 0148: the helpers open the
  framework's `libcef_sandbox.dylib`, signed with its other libraries); Linux (user namespaces under an
  AppArmor profile) and Windows (CEF's bootstrap and a client DLL) wait for #61.

## More Information

Issue #46; epic #32 §7, §10, §12. ADR 0143 (the shell), ADR 0054 and ADR 0092 (releases), ADR 0144
(no remote debugging in release builds). Procedure and sizes: `docs/releasing.md`, "The CEF desk".
