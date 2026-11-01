# apps/desk

The Tauri 2 app. A thin adapter only: `src-tauri/` forwards every bridge call to `crates/desk-core`,
and `src/` mounts the desk shell (`mountDesk`) and connects the bridge.

| Path | What it does |
| --- | --- |
| `src/main.ts` | Mounts the shell of `@endue-ai/runtime` on the tauri bridge adapter, then reports `desk_ready` |
| `src/native-files.ts` | Native single-file picker and queued native drops, routed through `desk.files.open` |
| `src/shell-bridge.ts` | The shell's `ShellBridge` over the core: store, perm, `brain.*` and the agent directory |
| `src-tauri/src/lib.rs` | Builds the core; the runtime (`desk`) holds `plugin:manage`, `cmd:invoke`, `brain:converse`, `connector:manage` and `view:manage` |
| `src-tauri/src/commands/` | `bridge_call` (to `Core::handle`) and `desk_ready` (logs the status line) |
| `src-tauri/capabilities/` | Main-window bridge/readiness, event listeners and native file picker |
| `src-tauri/tauri.conf.json` | Window, strict CSP, bundle; identifier `ai.endue.desk` |
| `src-tauri/icons/` | Placeholder icons generated from a flat accent square |

Mod+O (⌘O on macOS, Ctrl+O elsewhere) opens the native file picker. Dropping local files opens
them in order once the desk is ready; duplicate paths reuse their buffers. Cancelling does nothing.
Viewers still request their usual file permissions. Browser hosts keep the path-entry palette.

## Run and check

```bash
just brain-echo  # optional: the brain on :8787, whose agents fill the agent bar
just dev         # Vite on :1420 plus the app; the terminal prints "desk ready · bridge: tauri"
pnpm exec vitest run apps/desk   # the shell bridge, over the browser stub
just check-app   # clippy for the app crate (needs the platform webview SDK)
just build-app   # debug binary
```

The app crate is a workspace member but not a default member, so `just check` and `just test` do not
need the webview SDK. Linux needs `libwebkit2gtk-4.1-dev` and friends (see `.github/workflows/ci.yml`).
