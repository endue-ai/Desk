# desk-shell

The endue Desk shell on winit and CEF (ADR 0143), Stage 1 of #32: windows holding CEF browsers, the
desk's URL schemes and CEF's message pump, driven from winit's event loop when CEF asks
(`OnScheduleMessagePumpWork`). The desk starts through `desk-boot`; pages reach it through
`window.__deskNative`, the caller taken from the browser's window and the frame's URL (#43, #45).
It has the Tauri shell's services (#45): tray, menu bar, shortcuts, file dialog, one desk per data folder,
opened files, the palette, the floating Eris, the computer-use banner; it replaces `../src-tauri` after
Stage 1 (`endue-desk-cef`). Compositor mode (`DESK_COMPOSITOR=1`, ADR 0149, 0150) draws every surface
off screen with `desk-compositor` and routes their input.

## Public API

- `app::ShellApp`: the CEF application object of every process (switches, custom schemes).
- `pump::{Pump, Wake}`: when CEF's work is due; jobs from other threads for the event loop's thread.
- `window::Shell`, `pane::Pane`: the winit application and each window with its browser.
- `host`, `commands`: the bridge (`Desk`, `receive`, `Pages`) and the commands, named as Tauri's.
- `instance::claim`: an OS lock on `desk-instance.lock`; a second start hands its arguments over (`desk-instance.json`).
- `tray`, `menu`, `hotkeys`, `dialog`; `palette`, `eris_window`, `computer`, `float`, `displays`: the other
  windows; `open_files`, `run_event`, `drops`: files from the command line, Finder, the Dock and drags.
- `scheme`, `plugin_scheme`, `guard`, `paths`, `renderer`, `crashes`: schemes, loads, files, crashes.
- `web_host`: `specs/surface` for web content, a windowless browser per surface and its input (`input`,
  `key_codes`, `routes`, `drag`); `compositor_window`: the scene, frames' places, winit's input, the
  focus ring and drag image (`input`, `winit_input`, `overlay`); `harness`, `probe`: their checks.
- `sandbox`: each macOS helper enters Chromium's sandbox first (ADR 0148); off elsewhere until #61.
- `release`, `update`: the build's version, key, origin and commit; the updater over `desk_update::install`,
  the tray's "Restart to update", the restart once CEF has shut down (#47).

Packages (`packager/`, #46) carry the built-in plugins; `DESK_PLUGIN_DIRS` names others. Gaps: no Linux
tray (it needs a GTK loop); the pointer's display and work area are macOS-only.

## Run and test

```bash
just dev-shell      # builds the runtime and the shell; on macOS runs the .app bundle
just check-shell    # clippy -D warnings and the crate's tests (downloads CEF on first build)
```

`tests/{osr_import,lifecycle}.rs` run `--surface-probe` on `just build-shell`'s bundle; `e2e/specs/{ime,dnd}`
feed compositor mode winit's events; dev builds open DevTools when `DESK_REMOTE_DEBUGGING_PORT` is set.
