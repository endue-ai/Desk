# desk-shell

The endue Desk app, `endue-desk`, on winit and CEF (ADR 0143): windows holding CEF browsers, the
desk's URL schemes and CEF's message pump, driven from winit's event loop when CEF asks
(`OnScheduleMessagePumpWork`). The desk starts through `desk-boot`; pages reach it through
`window.__deskNative`, the caller taken from the browser's window and the frame's URL (#43, #45).
Its services (#45): tray, menus, shortcuts, file dialog, one desk per data folder, opened files, the
palette, the floating Eris, the computer-use banner. It replaced the Tauri shell, and took its binary's
name, when Stage 1 of #32 ended (#97). Compositor mode (`DESK_COMPOSITOR=1`, ADR 0149–0155) draws
every surface off screen with `desk-compositor`, places windows from `desk-wm`, routes their input.

## Public API

- `app::ShellApp`, `features`: the CEF application object of every process (switches, schemes, features off).
- `pump::{Pump, Wake}`: when CEF's work is due; jobs from other threads for the event loop's thread.
- `window::Shell`, `pane::Pane`: the winit application and each window with its browser.
- `host`, `commands`: the bridge (`Desk`, `receive`, `Pages`) and the commands, named as Tauri's were.
- `instance::claim`: an OS lock on `desk-instance.lock`; a second start hands its arguments over (`desk-instance.json`).
- `tray`, `menu`, `hotkeys`, `dialog`; `palette`, `eris_window`, `computer`, `float`, `displays`: the other
  windows; `open_files`, `run_event`, `drops`: files from the command line, Finder, the Dock and drags.
- `scheme`, `plugin_scheme`, `guard`, `paths`, `process_start`, `renderer`, `crashes`: schemes, loads, files, start, crashes.
- `native_host`: native plugins, each a process (#59, ADR 0154); `web_host`: web content, a windowless browser per
  surface on the frame clock (`frames`, `clock`), input (`input`, `key_codes`, `routes`, `drag`), its tree (`view::a11y`);
  `compositor_window`: `desk-wm`'s desk (`report`, `hosted`), `wm`, `draw`, AccessKit (`a11y`, ADR 0155); `harness`, `probe`.
- `sandbox`: each macOS helper enters Chromium's sandbox first (ADR 0148); off elsewhere until #61.
- `release`, `update`: the build's version, key, origin and commit; the updater over `desk_update::install`,
  the tray's "Restart to update", the restart once CEF has shut down (#47).

Packages (`packager/`, #46; icons in `icons/`) carry the built-in plugins; `DESK_PLUGIN_DIRS` names
others. Gaps: no Linux tray (it needs a GTK loop); the pointer's display and work area are macOS-only.

## Run and test

```bash
just dev            # builds the runtime and the shell; on macOS runs target/bundle/endue-desk.app
just check-shell    # clippy -D warnings and the crate's tests (downloads CEF on first build)
```

`tests/{osr_import,lifecycle,a11y}.rs` run `--surface-probe` on `just build-shell`'s bundle; `e2e/specs/{ime,dnd,a11y}`
drive compositor mode; dev builds open DevTools when `DESK_REMOTE_DEBUGGING_PORT` is set.
