# apps/desk

The Tauri 2 app. A thin adapter only: `src-tauri/` forwards every bridge call to `crates/desk-core`,
and `src/` mounts the runtime and connects the bridge.

| Path | What it does |
| --- | --- |
| `src/main.ts` | Mounts `@endue-ai/runtime` with the tauri bridge adapter, then reports `desk_ready` |
| `src-tauri/src/commands/` | `bridge_call` (to `Core::handle`, off the main thread) and `desk_ready` (logs the status line) |
| `src-tauri/src/prompt.rs` | Permission prompts as native dialogs (ADR 0016) |
| `src-tauri/capabilities/` | The main window may call exactly those two commands |
| `src-tauri/tauri.conf.json` | Window, strict CSP, bundle; identifier `ai.endue.desk` |
| `src-tauri/icons/` | Placeholder icons generated from a flat accent square |

## Run and check

```bash
just dev         # Vite on :1420 plus the app; the terminal prints "desk ready · bridge: tauri"
just check-app   # clippy for the app crate (needs the platform webview SDK)
just build-app   # debug binary
```

The app crate is a workspace member but not a default member, so `just check` and `just test` do not
need the webview SDK. Linux needs `libwebkit2gtk-4.1-dev` and friends (see `.github/workflows/ci.yml`).
