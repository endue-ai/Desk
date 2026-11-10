# apps/desk

The Tauri 2 app. A thin adapter only: `src-tauri/` forwards every bridge call to `crates/desk-core`,
and `src/` mounts the desk shell (`mountDesk`) and connects the bridge.

| Path | What it does |
| --- | --- |
| `src/main.ts` | Mounts the shell of `@endue-ai/runtime` on the tauri bridge adapter (`src/desk.ts`, with `src/start.ts` for what the start found), then reports `desk_ready`; `?view=palette` and `?view=eris` host the other windows |
| `src/eris-window.ts`, `src-tauri/src/eris_window/` | Eris floating over the OS while the desk is inactive, and `Alt+Enter` (⌥↩) from anywhere (ADR 0121): a tested state machine (`endue.eris.float` auto/always/never), her spot per display, the window calling the core as `desk` for `brain.say` only, `DESK_ERIS_SHORTCUT`, the tray's Talk to Eris |
| `src/native-files.ts` | Native single-file picker and queued native drops, routed through `desk.files.open` |
| `src/open-files.ts`, `src-tauri/src/open_files.rs` | Startup and running OS file-open queue, consumed after runtime readiness |
| `src/host.ts` | Which shell hosts the page: the CEF shell (`window.__deskNative`, #43) or Tauri; `invoke`, `listen` and the bridge adapter from either |
| `src/shell-bridge.ts` | The shell's `ShellBridge` over the core: store, perm, `brain.*` and the agent directory |
| `src/startup.ts`, `src-tauri/src/trace.rs` | `DESK_TRACE=1`: the start-up trace in the data folder (`trace.json`, `crates/desk-trace`), the runtime's phases sent with `desk_trace` |
| `src/crashes.ts`, `src-tauri/src/crash.rs` | Local crash reports (#322, `crates/desk-crash`): the panic hook and the window's uncaught errors (`desk_crash`) write `crashes/*.json`, redacted; the next start's card shows the newest once (`take_last_crash`); `DESK_E2E_PANIC=1` panics after the ready line |
| `src-tauri/src/lib.rs`, `src-tauri/src/run_event.rs` | Builds the core; the runtime (`desk`) holds `plugin:manage`, `cmd:invoke`, `perm:manage` (desk.describe, ADR 0075), `brain:converse`, `connector:manage` and `view:manage`. Closing the main window hides it; on macOS a click on the Dock icon shows it again (`RunEvent::Reopen`), as the tray's Open Desk does |
| `src-tauri/src/commands/` | Bridge forwarding, readiness logging (the trace's ready line; marks last-start.json), consuming OS file-open paths, and the start (ADR 0061): `--safe`/`DESK_SAFE=1` or a crash loop starts safe mode, `desk_start` tells the shell, `desk_relaunch` starts again without it |
| `src-tauri/capabilities/` | Main-window bridge/readiness/start-up phases, event listeners and native file picker; `palette.json` and `eris.json` for their windows |
| `src-tauri/tauri.conf.json` | Window, strict CSP, bundle, `macOSPrivateApi` (her transparent window); identifier `ai.endue.desk` |
| `src-tauri/icons/` | Placeholder icons generated from a flat accent square |
| `shell/`, `src/compositor-layout.ts` | The CEF shell that replaces `src-tauri/` (ADR 0143, Stage 1 of #32): winit window, windowed CEF browser, the `desk-app` scheme over `dist/` and CEF's message pump; `just dev-shell`. Its own README. In its compositor mode (`?compositor=1`, #52, ADR 0149) the page reports where its plugin frames are and what covers them (`compositor-visible.ts`) |

Mod+O (⌘O on macOS, Ctrl+O elsewhere) opens the native file picker. Dropping local files opens
them in order once the desk is ready; duplicate paths reuse their buffers. Cancelling does nothing.
Viewers still request their usual file permissions. Browser hosts keep the path-entry palette.
Packaged builds advertise common built-in formats as viewers. Finder/file-manager opens wait for the
runtime and focus the existing window; paths are consumed once without granting file access (ADR 0052).
Windows installers add Open With entries and preserve existing default-app choices on install/removal.
The attributed single-instance vendor keeps Linux on maintained zbus; see ADR 0052 and its NOTICE.

## Run and check

```bash
just brain-echo  # optional: the brain on :8787, whose agents fill the agent bar
just dev         # Vite on :1420 plus the app; the terminal prints "desk ready · bridge: tauri"
pnpm exec vitest run apps/desk   # the shell bridge, over the browser stub; the floating Eris window
just check-app   # native lint/tests and single-instance integration (needs the webview SDK)
just build-app   # debug binary
```

The app crate is a workspace member but not a default member, so `just check` and `just test` do not
need the webview SDK. Linux needs `libwebkit2gtk-4.1-dev` and friends (see `.github/workflows/ci.yml`).
