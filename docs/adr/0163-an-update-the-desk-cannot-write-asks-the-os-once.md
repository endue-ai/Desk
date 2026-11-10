---
status: accepted
date: 2026-11-11
decision-makers: Team endue
---

# An update the desk cannot write asks the OS once, and root installs only the bytes that were checked

## Context and Problem Statement

ADR 0147 gave the CEF desk its own installer. Where the desk may not write its app's folder (an app
in `/Applications` that another user installed, an app it may not move, an install under `Program
Files`), an update failed, named the folder and stayed staged (#47). The Tauri updater asked for an
administrator's password there instead. How does the CEF desk get an administrator's approval on each
OS, and what may run with it?

## Decision Drivers

* The person is asked once per apply, by the OS's own prompt, never by a password field of the desk's
* The update's signature and its app are checked before the prompt: nobody is asked for a bad build
* What runs as root is small, readable, and installs exactly the bytes that were verified
* A declined prompt changes nothing, keeps the build staged and says so plainly, once
* Tests never show a real prompt: a person may be using the machine

## Considered Options

* macOS: `osascript` `do shell script … with administrator privileges` running a short `sh` step
* macOS: `AuthorizationExecuteWithPrivileges`
* macOS: a privileged helper installed with `SMJobBless` or registered with `SMAppService`
* Root moves the bundle the desk unpacked as the person; or root unpacks its own copy of the archive

## Decision Outcome

Chosen option: "`osascript` running a short `sh` step, which unpacks its own copy", because it ships
with every macOS, asks through Authorization Services as the Tauri updater did, needs no
entitlement, signing requirement or launchd job, and keeps what runs as root to one script in the
repository. `AuthorizationExecuteWithPrivileges` has been deprecated since macOS 10.7 and needs
`unsafe` bindings; `SMJobBless` and `SMAppService` install a daemon that stays root after the update,
with its own code signing requirements and XPC protocol, for a step that runs once per update.

* **The step's inputs.** `elevate::Step` is a program and its arguments. On macOS the arguments
  reach an AppleScript as `argv` and each is quoted with `quoted form of`, so no path the desk passes
  is ever read as AppleScript or shell. The prompt says "endue Desk needs an administrator to install
  its update to <version>."
* **What root runs** (`crates/desk-update/src/install/admin.sh`): the archive the updater verified
  (minisign, then the manifest's SHA-256), the SHA-256, the installed app, the app's folder in the
  archive and its executable. It makes a folder of its own beside the app (`mktemp`, 0700, owned by
  root), copies the archive in, checks the copy's SHA-256, unpacks the copy there without owners,
  set-uid bits, extended attributes or flags from the archive, checks the app and its executable,
  lifts the quarantine mark, and swaps the two apps in one step (`renamex_np(RENAME_SWAP)` through
  JavaScript for Automation, as Tauri's updater does; two moves where the volume cannot swap). The
  new app belongs to root. Root never moves what the person's account unpacked: a bundle the account
  owns would stay writable by it in `/Applications`, and could be changed between the check and the
  move.
* **When it asks.** The desk first installs in place as before. When it may not create its folder
  beside the app, or may not move the app, it unpacks and checks the update in `<data>/updates`, then
  asks once. A read-only volume (a disk image) is not asked about: an administrator cannot write it.
* **Linux.** A `.deb` runs `dpkg -i` behind `pkexec` through the same `Step`; exit 126 (the dialog
  dismissed) is a decline. An AppImage is never elevated: a folder the desk may not write fails with
  the artifact's URL, the file to replace and the hint to keep AppImages in a folder the person
  writes, such as `~/Applications`.
* **Windows.** The MSI already ran `msiexec /qn` through UAC (`-Verb RunAs`). The NSIS installer is
  per user (`installMode: currentUser`) and runs plainly, unless the desk cannot write its own folder,
  probed with a file before it quits: then it too runs through UAC. The PowerShell that runs the
  installer after the desk has quit notes a declined prompt (`ERROR_CANCELLED`, 1223), an installer
  that did not start, or one that exited other than 0 or 3010 in `<data>/updates/<version>/install.outcome`.
* **Declined, once.** A declined prompt is an install that failed: the state is `failed` with the
  build staged and the reason "the administrator prompt to … was cancelled. Nothing changed; the
  update stays ready", which the runtime's update row shows with "Try again". The next check shows the
  build ready again; nothing asks again until the person applies. On Windows the desk that starts
  next reads the note once (`Installer::last_attempt`) and removes it.
* **Tests.** The installer takes its `Elevate`; the app passes `SystemPrompt`, and no test makes one.
  `tests/read_only.rs` declines, approves without running, and checks what was asked;
  `tests/admin_swap.rs` (macOS) runs `admin.sh` whole as the test's user, the read-only folder opened
  as root would write it, including an archive rewritten between the check and the step.

### Consequences

* Good, because a desk installed by someone else updates with one administrator's approval, as the
  Tauri desk did, and the person's account cannot change what root installs.
* Good, because the step that runs as root is 50 lines of `sh` in the repository, tested whole.
* Bad, because the prompt is `osascript`'s: macOS shows its icon, not the desk's.
* Bad, because the real prompts (macOS, `pkexec`, UAC) are proven only by hand (#61); the tests run
  the step without them.
* Bad, because a per-user NSIS installer run through UAC by another administrator's account writes
  its shortcuts and registry keys for that account; the desk's files update either way.
* Bad, because an update applied with an administrator's approval leaves an app owned by root, so the
  next update asks again.

## More Information

Issue #99 (found by #47); epic #32 §7, §12. ADR 0054 (the updater), ADR 0147 (the installer without
Tauri). Code: `crates/desk-update/src/install/{elevate,admin,app,file,windows}.rs`,
`crates/desk-update/src/install/admin.sh`, `apps/desk/shell/src/update.rs`. Tauri's own path:
`tauri-plugin-updater` 2.14, `updater.rs`, the macOS `install_inner`.
