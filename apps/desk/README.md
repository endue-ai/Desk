# apps/desk

The desk app. `src/` is the web frontend: it mounts the desk shell (`mountDesk`) on the Rust core and
connects the bridge; Vite builds it into `dist/`. `shell/` is the CEF shell (ADR 0143, its own
README) that serves `dist/` over `desk-app://` and forwards every bridge call to `crates/desk-core`.

| Path | What it does |
| --- | --- |
| `src/main.ts` | Mounts the shell of `@endue-ai/runtime` on the CEF bridge adapter (`src/desk.ts`, with `src/start.ts` for what the start found), then reports `desk_ready`; `?view=palette` and `?view=eris` host the other windows |
| `src/host.ts` | The page's shell: `invoke`, `listen` and the bridge adapter over `window.__deskNative` (#43); without it every command is refused with the reason |
| `src/eris-window.ts`, `shell/src/eris_window/` | Eris floating over the OS while the desk is inactive, and `Alt+Enter` (⌥↩) from anywhere (ADR 0121): a tested state machine (`endue.eris.float` auto/always/never), her spot per display, the window calling the core as `desk` for `brain.say` only, `DESK_ERIS_SHORTCUT`, the tray's Talk to Eris |
| `src/native-files.ts`, `src/page-drags.ts`, `shell/src/{dialog,drops}.rs` | Native single-file picker (`plugin:dialog\|open`) and drops from the OS (`desk://drag-enter`, then the page's own drag), routed through `desk.files.open` or to the plugin under the pointer |
| `src/open-files.ts`, `shell/src/{open_files,run_event}.rs` | Startup and running OS file-open queue (command line, Finder and the Dock, a second start), consumed after runtime readiness |
| `src/shell-bridge.ts` | The shell's `ShellBridge` over the core: store, perm, `brain.*` and the agent directory |
| `src/startup.ts`, `crates/desk-boot/src/trace.rs` | `DESK_TRACE=1`: the start-up trace in the data folder (`trace.json`, `crates/desk-trace`), the runtime's phases sent with `desk_trace` |
| `src/crashes.ts`, `crates/desk-boot/src/crash.rs` | Local crash reports (#322, `crates/desk-crash`): the panic hook and the window's uncaught errors (`desk_crash`) write `crashes/*.json`, redacted; the next start's card shows the newest once (`take_last_crash`); `DESK_E2E_PANIC=1` panics after the ready line |
| `shell/src/commands.rs`, `crates/desk-boot/src/{start,grants}.rs` | The page's commands per window (`desk_web::sender`): bridge forwarding, the ready line (marks last-start.json), OS file-open paths, the start (ADR 0061: `--safe`/`DESK_SAFE=1` or a crash loop starts safe mode, `desk_relaunch` starts again without it); the runtime (`desk`) holds `plugin:manage`, `cmd:invoke`, `perm:manage` (ADR 0075), `brain:converse`, `connector:manage`, `view:manage` |
| `src/compositor-*.ts`, `src/compositor.css` | The compositor's seam, always on since #83 (#52, ADR 0149–0160): the page is the desk's system surface; it reports each plugin surface's page, its own plugin surfaces' places and layers and its system parts' boxes and hears the live budget's set (`compositor-desk.ts`, `compositor-system.ts`), carries the plugin host's messages to each surface's own browser and back (`compositor-surfaces.ts`: `__deskNative.post(text, host)`, `onSurface`), tells desk-wm what a press starts, forwards the window commands and takes desk-wm's changes (`compositor-wm.ts`), reports the keymap's keys and which surface's place has the focus, and draws only its system layer and its own views (`compositor.css`) |
| `shell/icons/`, `shell/packager/` | Placeholder icons from a flat accent square; the bundles, their Info.plist and desktop entry (#46) |

Mod+O (⌘O on macOS, Ctrl+O elsewhere) opens the native file picker. Dropping local files opens
them in order once the desk is ready; duplicate paths reuse their buffers. Cancelling does nothing.
Viewers still request their usual file permissions. Browser hosts keep the path-entry palette.
Packaged builds advertise common built-in formats as viewers (macOS and Linux). Finder/file-manager
opens wait for the runtime and focus the existing window; paths are consumed once without granting
file access (ADR 0052). Closing the main window hides it; the Dock icon and the tray show it again.

## Run and check

```bash
just brain-echo  # optional: the brain on :8787, whose agents fill the agent bar
just dev         # build and run the CEF desk with plugins/ and the dev plugins; prints "desk ready · bridge: cef"
pnpm exec vitest run apps/desk   # the page's modules, over a fake shell; the floating Eris window
just build-shell # the shell, the web frontend it serves and on macOS target/bundle/endue-desk.app
just check-shell # the shell crate's lints and tests (downloads and builds CEF, so `just check` skips it)
```
