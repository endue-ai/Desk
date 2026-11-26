---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Built-in agent tools and person-owned actions

## Context and Problem Statement

EP-01 through EP-25 (#717–#741) established the agent and approval paths for #716. The second
pass reads the shipped manifests and the runtime registrations together. At the start of this
pass, 66 built-ins, including 41 UI plugins, declared 695 commands, 432 offered to agents. The
desk also registers commands outside the manifests. Android device actions, image pan, details
and slice controls, and Player's view, chapter and retry paths needed additional coverage.

## Decision Drivers

- A read answers from the state the person can see. Reading an idle window uses cached state.
- A reviewed guest action must identify the session it will affect and still have the plugin's
  SDK grant when it runs. A review cannot silently move to a replacement device.
- Use the same view, file grants and transport as the person's controls.

## Considered Options

- Route agent controls through the page's buttons and simulate the existing confirmations.
- Share the controllers and let the core review one operation with its original arguments.

## Decision Outcome

Android Emulator discovers devices following the person's Refresh or SDK Apply. Opening the
window and reading `state` return existing information. The connected session has an ID that
changes on reconnect, even when the same serial comes back. Pausing capture and disconnecting
are local. A command that runs ADB or resumes capture uses `operate`, with one core review and
the exact session ID. It uses the current SDK grant and verifies the ADB transport. Guest calls
target the transport ID. ADB's emulator console only accepts a serial, so the controller verifies
the transport immediately before a console operation and refuses if it changed. A refused or
revoked grant returns the failure to the caller. Background preview uses the same transport and
an existing grant and pauses on failure.
Preview coordinates are checked against the drawn frame. The same SDK controller supplies app
and snapshot lists, selects the package, and applies the operation.

Images shares the existing view with `pan`, `show-details` and `slice`. A newer slice selection
or a different active image invalidates an outstanding decode. All eight commands support the
exact pane from `desk.windows.list`. Player shares its loop and theatre controls, reports the
current chapters, seeks to an identified chapter and retries the current file under its read
grant. These display and transport changes affect the current view.

## Second audit

The resulting 66 manifests declare 705 commands, including 442 agent commands. Commands that
forward a button or a keyboard shortcut often share the agent operation under a different
name. The table includes the runtime providers and the built-ins with no agent marker.

| Built-ins | Shared agent paths and coverage |
| --- | --- |
| Buffers, Display, Files, Shell, Session, Launcher, Sidebar, Toolbar and Palette | File opening and search, the current workspace and exact window listing, desktop navigation, focus, close and arrangement. The launcher's plugin opening and the sidebar's window selection use the runtime's plugin and window operations. The palette's items are offered directly as commands. ADR 0377. |
| Theme, Design, Profiles, Notify, Market and Login | Runtime settings, theme/design list and explicit changes, notifications, profiles, and plugin/market lookup and installation. Themes Amber, Fjord, Glass and Paper, design systems Blueprint, Compact and Soft, and Formats contribute data, styles or SDK formats. Choose installed themes and design systems through the runtime. ADRs 0376–0378. |
| Agents, Eris, Fleet, Local Agents, Local Models and Computer | Agent definitions and runs, local detection/model selection, board and transcripts, activity and stop, and computer observation and reviewed input. Eris's own tools use the core's turn and command surface. ADRs 0072, 0089, 0109, 0375 and 0377. |
| API Studio, Browser, Network, Screens and Web | Saved safe HTTP/API reads, current tabs, page reads and navigation, form state and reviewed submission, endpoint tests and active VNC session operations. ADRs 0382, 0385 and 0390. |
| Docker, Docker Studio, Terminal, Git, Git Studio and Database | Current process/container/repository/connection state, logs and diffs, local edits, exact file or record actions, and reviewed execution, removal, commits and remote changes. User-facing aliases and Undo handlers share these operations. ADRs 0379–0384. |
| GitHub and the GitHub pack | The built-in connector supplies accounts and items. The pack and GitHub Studio tools cover the synced issues, pull requests and reviewed remote actions. ADR 0385. |
| Explorer, Notes, Data and Archives | List, select, open, show, search, edit, rename, Trash and extract under the scoped file operations. Explorer clipboard and selection shortcuts are the person's selection UI for paths the agent can address directly. ADR 0386. |
| Chat, Mail, Calendar and Projects | Read the open view, navigate and change local drafts or event buffers, then review sending, saving to calendar and changing remote project work. Read exact calendars/layers and project lanes and tracker state. ADRs 0387 and 0388. |
| Views, Universal, Today, Chat Digest, Item and Memory | Open, list and read saved views, including the built-in item layouts and their account selections. The same item query and clock drive the rendered views. Universal renders those views and Eris's existing inline preview. Memory offers find and reviewed forgetting by ID. ADR 0389. |
| Docs, Reader, Sheets, Slides, Images and Player | Read the displayed document, slide, sheet, image or media item, and move through each with the same controls. Reader marks, sheet edits and versioned saves are available. Images and Player share view and transport actions. ADRs 0391, 0392 and this decision. |
| Android Emulator | Local state, pause and disconnect, and reviewed actions against a connected device, as above. |
| Onboarding, Permissions and Inspector | Setup, trust decisions and privileged diagnostics belong to the person. Narrow agent tools cover the resulting configuration, window and application state under their own scopes. |

### Person-owned actions

| Action | Reason |
| --- | --- |
| Permissions grants, denies and cancelling the active approval run | The answer belongs to the person whose authority the agent requests. Permission-management providers are excluded from the core's agent offer. |
| Onboarding name, sign-in, a verification code, microphone consent and the first account or calendar choice | Each chooses an identity, shares an authentication secret, authorizes an OS resource or creates a continuing source binding. |
| Login start-at-login toggle and native launch confirmation | Changing the OS session's startup behavior needs the account's owner. |
| Inspector raw traces, bridge params, raw settings and the full grant log | These may carry private payloads or credentials. The safe window, setting and activity tools return scoped fields. |
| Account connection, account picker or reconnect in Chat, Mail, Browser, Calendar, Projects, GitHub and Views | The person selects the identity with continuing access and completes its authentication. Ordinary reads and reviewed remote commands use the selected source. |
| Choosing a new permission or trusted environment in Terminal, Docker, Database, Computer, Screen Sharing or Local Agents | Endpoint credentials, host keys, shell trust, accessibility and capture permissions, and choices about the agent installation affect future access. Activities using the existing choices go through the program, endpoint or exact operation reviews. |
| Opening a native file manager or an item's original in another app | The reveal is a hand-off to an OS app. A person chooses that destination. The exact file or saved item remains addressable in Desk. |
| File pickers, save location, Explorer clipboard and palette selection | These capture consent for particular paths or perform an OS clipboard exchange. Agent tools name exact paths and use the scoped grants and versioned saves. |
| Universal builder's data-role mapping, source binding, Apply, Try again and Discard | The author decides how a draft binds an account, command or file before keeping or running it. A requested draft and preview use the existing review path. |
| Eris's composer, attachment chooser and reviewing an Eris proposal, and a Local Agents composer choosing the current agent | These originate the person's instruction or attachment and supply actor intent. Agent tools receive explicit jobs from the originating turn. |
| Memory bulk forget and editing the person's recorded wording | Bulk removal and wording are intentional changes to the person's record. An agent can find and forget an individual fact after review, and remember within its own allowed scope. |
| Android SDK directory, device discovery, selecting or starting a virtual device, and cancelling a boot | These select which executable and local device Desk trusts, establish a connection or stop the person's in-flight launch. An established connection can be read and operated by exact ID. |
| Android APK picker and full-resolution PNG save | The person chooses the package entering the guest or the host file receiving raw screen pixels. The read exposes the frame geometry and state. |
| Android raw Logcat and screen pixels | Both can contain messages, credentials or personal material from guest apps. App diagnostics use the selected package and bounded output. |
| Android save or replace a named conditions preset | A named preset can retain precise GPS coordinates as a persistent test fixture. The person decides which fixture to retain. Agents can read and apply selected conditions to the reviewed guest. |

### Approval checks

| Tier | Test evidence |
| --- | --- |
| 0, read or show | Core installed-tool and read-only command tests, quiet Android state in `android-emulator.spec.ts`, and the Image and Player view regressions. |
| 1, explicit selection | ADR 0374's scoped choice tests cover open, save, drop and attach; the file-viewer tests exercise the picked playlist's hand-off. |
| 2, reversible local operation | ADR 0373's tested receipts cover a granted versioned save and memory edit. ADR 0383 verifies reviewed Git discard's scoped inverse. ADR 0391 tests Sheets restoring the version written by the same actor. |
| 3, reviewed effect | ADRs 0372 and 0375 test exact target approval, failed or stale requests and plugin-scope hand-off. Android tests check review gating, a stale session, coordinate bounds and quiet refusal with the SDK grant removed. |

Core command/tool tests and the browser e2e exercise different layers. The browser fixture has a
fake Android SDK. The native SDK, hardware and account flows need the corresponding environment.

## Consequences

- A device window can open and describe its idle state without starting an SDK program.
- Eris can use the existing grant for a reviewed guest action on the original connected device.
- The audit records the user decisions at each authority boundary and the paths to test when a
  built-in adds a control.

## More Information

- [Issue #716](https://github.com/endue-ai/endue/issues/716)
- [Testing](../qa/TESTING.md)
- [Android Debug Bridge client](https://android.googlesource.com/platform/packages/modules/adb/+/refs/tags/platform-tools-34.0.0/client/commandline.cpp)
