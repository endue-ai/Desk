---
status: accepted
date: 2026-11-10
decision-makers: Team endue
---

# The CEF desk installs its own updates, from the containers Tauri's updater reads

## Context and Problem Statement

ADR 0054 reuses `tauri-plugin-updater` for the install, the part that is easy to get wrong; the
CEF desk (ADR 0143) has no Tauri, so it cannot. Beta desks run the Tauri desk today, and #32 needs
them to move to the CEF desk through the normal updater flow, once and for good, then keep updating
as CEF desks. ADR 0145 lets a release line build the CEF desk in the canonical artifact names.
Who installs a build on the CEF desk, which artifacts does the transition release carry, and how
does a desk start again?

## Decision Drivers

* `desk-update`'s state machine, policy, minisign check and staging stay as they are (ADR 0054)
* One release serves both desks: the last Tauri build must accept the CEF build's artifacts
* A failed install leaves the running desk as it was, and the staged build for another try
* The install paths are tested, not trusted: the failure paths run in `cargo test`
* The person still applies an update with one action; nothing installs on its own

## Considered Options

* `desk_update::install` (feature `install`): the OS mechanics without Tauri, with the shell
  supplying where it is installed and how it quits and starts again; the artifacts unchanged
* Keep `tauri-plugin-updater` in the CEF desk for its install functions only
* A transition release in new containers (a zip of the CEF app) and a Tauri build that reads them

## Decision Outcome

Chosen option: "`desk_update::install` and the artifacts unchanged", because the plugin's install
needs a Tauri `AppHandle` and its `Update` object, which the CEF desk cannot make, and new containers
would need one more Tauri release before the switch. The canonical artifacts (`.app.tar.gz`,
`-setup.exe`, `.AppImage`, `.deb`) are what tauri-plugin-updater 2.14 already installs, so a Tauri desk
on beta installs the CEF build as it installs any other.

* **Layout.** The running desk finds how it is installed (`install::Layout::of`): an `.app` bundle on
  macOS; `$APPIMAGE`, or an executable under `/usr/lib` (the `.deb`), on Linux; `uninstall.exe` beside
  the executable (NSIS), or under Program Files (MSI), on Windows. A development build has none and
  does not update itself. The layout names the targets (`darwin-aarch64-app`, then `darwin-aarch64`);
  a `.deb` and an MSI never fall back to the plain target, which is another package.
* **Install.** macOS unpacks the `.app.tar.gz` beside the installed app, checks that it holds one app
  whose Info.plist names an executable that is there and the installed app's identifier, lifts the
  quarantine mark macOS puts on every file the desk writes (`LSFileQuarantineEnabled`, ADR 0145; with
  it Gatekeeper held the new app's start for an answer), then swaps the two in one step
  (`renamex_np(RENAME_SWAP)`; two renames where the volume cannot swap) and removes the old one. An
  AppImage is written beside itself and renamed over. A `.deb` goes through
  `pkexec dpkg -i` (ADR 0054). On Windows the installer cannot replace a running desk: the update keeps
  the NSIS `-setup.exe` or the `.msi` in `<data>/updates`, and the restart is a hidden PowerShell that
  waits for the desk's process, runs the installer silently (NSIS `/S /D=<the desk's folder>`,
  `msiexec /qn` with the elevation prompt an MSI under Program Files needs) and starts the desk.
  Every check runs before anything moves; no permission to write is an error that names the folder.
* **Restart.** Applying asks the shell to quit as the menu's Quit does. Once CEF has shut down, the
  desk lets go of its single-instance lock, its desk socket and its watchers, then starts the new desk
  detached, its output in `<data>/updates/restart.log`, and exits.
* **The MSI updates MSI installs.** The CEF desk's `.msi` (ADR 0145's first-install image) is signed
  as an updater artifact and listed as `windows-x86_64-msi`, so a desk installed from it updates
  through it; the schema's target pattern already admits it.
* **What the build says.** The CEF desk reports `DESK_VERSION`, takes `DESK_UPDATER_PUBKEY`,
  `DESK_UPDATE_URL` and `DESK_BUILD_COMMIT` from its build, and allows plain `http://` only for an
  origin on this machine (the rehearsal's file server) or in a development build.
* **The `.deb` transition.** A Tauri desk restarts the binary it started as, `/usr/bin/endue-desk`,
  which the CEF `.deb` removes: the CEF `.deb` carries the launcher there too until the CEF binary
  takes that name at the end of Stage 1.

### Consequences

* Good, because one beta release moves Tauri desks to the CEF desk with no Tauri release first.
* Good, because the failure paths (a bad signature, a partial download, no permission to write) are
  plain Rust tests over real files, and the two hops are a smoke (`e2e/smoke/update-two-hops.sh`).
* Good, because a staged build applies after a restart with no network fetch, which ADR 0054's plugin
  handle needed.
* Bad, because the Windows and Linux paths are proven only on those OSes (#61), and the macOS one with
  a Developer ID signature only on the signing runner; the rehearsal here was ad-hoc signed.
* Bad, because no administrator prompt replaces an app the person cannot write: they move the app or
  install the update by hand. Tauri's plugin asked for an administrator's password there.
* Bad, because only versions and channels keep the transition one way: the installer takes any
  newer build of `ai.endue.desk`, Tauri's too, and canary still lists Tauri builds. A pre-release desk
  without a channel set follows canary (the core's default for any `-` version, `-rc` included), so a
  CEF beta desk must follow beta, as the smoke sets it.

## More Information

Issue #47; epic #32 §7, §12. ADR 0054 (the updater), ADR 0092 (release lines), ADR 0143 (the shell),
ADR 0145 (packages and `.github/release-shell`). Code: `crates/desk-update/src/install/`,
`apps/desk/shell/src/update.rs`, `apps/desk/shell/src/release.rs`. Procedure: `docs/releasing.md`, "The
CEF desk".
