---
status: accepted
date: 2026-11-01
decision-makers: Team endue
---

# OS file-open requests wait for the runtime

## Context and Problem Statement

Desktop file associations can launch Desk before its web runtime has registered file commands.
An event sent only to the frontend can be lost; replaying stored paths and events can open a file twice.
The existing file policy and viewer permissions already decide how a local file opens.

## Decision Drivers

- Cold and running launches use the same command and permission flow.
- Native input remains data, with no shell evaluation, content reads or new filesystem grants.
- File delivery must survive asynchronous listener registration and runtime startup.

## Considered Options

- Send file paths directly in frontend events.
- Persist and replay file-open events in the core.
- Keep an app-local consumable queue and signal when it has work.

## Decision Outcome

Chosen option: "an app-local consumable queue", because it covers startup without changing the public
bridge. macOS `RunEvent::Opened` supplies file URLs; startup/forwarded arguments supply absolute local
paths. The single-instance plugin runs first and focuses the existing window. Non-file URLs,
flags, relative paths and malformed inputs are ignored. Pending duplicates coalesce; later opens remain possible.

The main window subscribes before its first `take_open_files` drain, waits for `desk.ready`, and serially
runs `desk.files.open`. Arrivals during a drain schedule another drain. Individual errors are reported
without replay or blocking later files. Viewer associations are restricted to verified built-in formats
and use the alternate rank on macOS. Windows disables Tauri's generated association registration,
which writes extension defaults, and uses supported NSIS hooks/WiX fragments to add only Desk's ProgID
and named `OpenWithProgids` values. Install, upgrade and removal leave extension defaults, `UserChoice`
and other applications' entries untouched. Linux advertises MIME types without changing `mimeapps.list`; its supported desktop template adds
`%F` so file managers pass each local file as a separate argument (Debian/RPM and AppImage).

The single-instance plugin is a narrow local copy of official version 2.5.5: its published Windows,
macOS and public API source stays intact, while Linux uses maintained zbus 6. The stable upstream
plugin still pulls the discontinued zbus 5 type crates (RustSec 2026-0370/0371/0372); target-gating it
does not remove those packages from Cargo's all-target policy graph. No advisory is suppressed.
`vendor/tauri-plugin-single-instance/NOTICE` records provenance, licenses and the removal condition:
return to an official Tauri 2 compatible release when it adopts maintained zbus and passes the same
private-bus delivery and cleanup tests. The Linux primary owns its async runtime and connection until
resource cleanup; a secondary succeeds only after the primary acknowledges its arguments.

### Consequences

- Good: the host never reads file contents or grants a viewer access; startup and running opens agree.
- Bad: the local Linux port needs maintenance until upstream adopts zbus 6.
- Bad: the in-memory queue is lost if the process exits; consumed requests are not retried on frontend reload.

## More Information

[Task #212](https://github.com/endue-ai/Desk/issues/212),
[Tauri single instance](https://v2.tauri.app/plugin/single-instance/),
[upstream zbus 6 migration](https://github.com/tauri-apps/plugins-workspace/pull/3722),
[Tauri file associations](https://v2.tauri.app/reference/config/#fileassociation),
[Tauri installer customization](https://v2.tauri.app/distribute/windows-installer/),
[Microsoft Open With registration](https://learn.microsoft.com/en-us/windows/win32/shell/how-to-include-an-application-on-the-open-with-dialog-box),
[freedesktop Exec fields](https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html).
This is app-host delivery within the existing runtime/file-policy design; no design-source section changes.
