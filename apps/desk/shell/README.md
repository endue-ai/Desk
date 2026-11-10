# desk-shell

The endue Desk shell on winit and CEF (ADR 0143), Stage 1 of #32: windows holding CEF browsers, the
desk's URL schemes and CEF's message pump, driven from winit's event loop when CEF asks
(`OnScheduleMessagePumpWork`). The desk starts through `desk-boot`; pages reach it through
`window.__deskNative`, the caller taken from the browser's window and the frame's URL (#43, #45).
It has the Tauri shell's services (#45): tray, menu bar, global shortcuts, file dialog, one desk per
data folder, files opened with the desk, the palette, the floating Eris and the computer-use banner. It replaces the Tauri shell (`../src-tauri`) when Stage 1 ends; until then its
binary is `endue-desk-cef`. Compositor mode (`DESK_COMPOSITOR=1` or `--compositor`, #52, ADR 0149)
draws the main window with `desk-compositor` instead: the page and every plugin surface off screen.

## Public API

- `app::ShellApp`: the CEF application object of every process (switches, custom schemes).
- `pump::{Pump, Wake}`: when CEF's work is due; jobs from other threads for the event loop's thread.
- `window::Shell`, `pane::Pane`: the winit application and each window with its browser.
- `host`, `commands`: the bridge (`Desk`, `receive`, `Pages`) and the commands, named as Tauri's.
- `instance::claim`: an OS lock on `desk-instance.lock`; a second start hands its arguments over (`desk-instance.json`).
- `tray`, `menu`, `hotkeys`, `dialog` (`tray-icon`, `muda`, `global-hotkey`, `rfd`); `palette`,
  `eris_window`, `computer`, `float`, `displays`: the other windows and their placement.
- `open_files`, `run_event`, `drops`: files from the command line, Finder, the Dock and drags.
- `scheme`, `plugin_scheme`, `guard`, `paths`, `renderer`: schemes, loads, files, `__deskNative`;
  `crashes::watch` names a plugin frame whose renderer died (`desk://frame-crashed`).
- `web_host`: `specs/surface` for web content, a windowless browser per surface; `compositor_window`: the
  wgpu scene and the frames' places; `probe`: their checks.
- `sandbox`: each macOS helper enters Chromium's sandbox first (ADR 0148); off elsewhere until #61.
- `release`, `update`: the build's version, key, origin and commit; the updater over `desk_update::install`,
  the tray's "Restart to update", the restart once CEF has shut down (#47).

Packages (`packager/`, #46) carry the built-in plugins; `DESK_PLUGIN_DIRS` names others. Gaps: no Linux
tray yet (it needs a GTK loop); the pointer's display and work area are macOS-only.

## Run and test

```bash
just dev-shell      # builds the runtime and the shell; on macOS runs the .app bundle
just check-shell    # clippy -D warnings and the crate's tests (downloads CEF on first build)
```

`tests/osr_import.rs` and `lifecycle.rs` run `--surface-probe` on `just build-shell`'s bundle; dev builds
open DevTools when `DESK_REMOTE_DEBUGGING_PORT` is set; `e2e/smoke/update-two-hops.sh` updates packages.
