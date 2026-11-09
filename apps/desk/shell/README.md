# desk-shell

The endue Desk shell on winit and CEF (ADR 0143), Stage 1 of #32: a window holding a CEF browser,
the desk's URL schemes and CEF's message pump, driven from winit's event loop when CEF asks
(`OnScheduleMessagePumpWork`). The desk starts through `desk-boot`; the page reaches it through
`window.__deskNative` and CEF process messages, the caller taken from the frame's URL (#43). It
replaces the Tauri shell (`../src-tauri`) when Stage 1 ends; until then its binary is `endue-desk-cef`.
The plugin scheme and the shell's services (tray, palette, Eris) arrive with #42 and #45.

## Public API

- `app::ShellApp`: the CEF application object of every process (switches, custom schemes).
- `pump::Pump`: when CEF's message loop work is due; wakes the event loop.
- `scheme::answer(dist, url)`: what `desk-app://app/...` returns (files via `desk_web::assets`).
- `window::Shell`: the winit application with the windowed browser.
- `renderer::ShellRenderer`: `__deskNative.send` / `onMessage` in every frame (renderer process).
- `host::{Desk, receive, forward_events}`: the browser side; commands named as the Tauri shell's.
- `crashes::watch`: Chromium's target discovery names a plugin frame whose renderer died (`desk://frame-crashed`).
- `paths`: the shell's files (`DESK_SHELL_DIST`), its data folder and the start URL (`DESK_SHELL_URL`).

## Run and test

```bash
just dev-shell      # builds the runtime and the shell; on macOS runs the .app bundle
just check-shell    # clippy -D warnings and the crate's tests (downloads CEF on first build)
```

Development builds open Chromium's DevTools protocol when `DESK_REMOTE_DEBUGGING_PORT` is set.
