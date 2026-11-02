# e2e

App-level tests that drive the packaged desktop app: what the browser stub cannot show, such as the
first run, plugins and the session across a relaunch.

| Path | Purpose |
| --- | --- |
| `wdio.conf.ts` | WebdriverIO + tauri-driver: one app process per spec file, each with a fresh `HOME` |
| `specs/` | On the desk shell, Default profile: `launch` (both layers, ready line, first run, Skip intro), `plugins` (the Plugins list toggled from the keyboard), `session` (the dock and the desktop switcher across a relaunch), `themes` (user themes in the data folder: one the runtime saves with `theme.save` and one copied into `themes/` by hand, both listed after a relaunch) |
| `support/` | `driver.ts` starts tauri-driver per spec; `desk.ts` holds the specs' helpers |
| `driver/` | `webkit-webdriver.sh`: the native driver, with the app's stdout kept for the log |
| `fixtures/` | `init.yaml` (the template), `init-no-first-run.yaml`, the `e2e.hello` test plugin, the `local.e2e-paper` user theme (`theme-e2e-paper`) |
| `smoke/` | `install-and-launch.sh` (the Linux .deb), `verify-signature.sh` (a stub until signing) |
| `perf/` | `budgets.json` (the opening frame-time baseline of `just perf-opening`, and the app's); `just perf-app`: `startup` (a second start with six surfaces saved, from `DESK_TRACE=1`'s trace), `memory` (RSS 5 min after start), `latency` (palette and focus switch, p95 of 20); `lib/` the pure parts, unit tested |

## Run

```bash
just bundle-app                 # release build and .deb (Linux)
xvfb-run -a just test-app-e2e   # all specs; add `--spec e2e/specs/launch.spec.ts` for one
xvfb-run -a just perf-app       # e2e/perf, results in e2e/test-results/perf; `record` sets baselines
xvfb-run -a just smoke          # build, install, launch, ready line, quit
```

Linux only: on macOS the recipes refuse, since tauri-driver does not run there (ADR 0006); the `e2e`
workflow runs them. They need tauri-driver 2.1.0, `webkit2gtk-driver` and a display. `DESK_APP`
points the specs at another binary. Logs and failure screenshots go to `test-results/`.

Each spec starts the app with `HOME` in a temp folder (so the data folder and WebKit's storage start
empty), `DESK_INIT` on a fixture, `DESK_PLUGIN_DIRS=plugins/`, `DESK_DEV_PLUGINS` on the test plugin
and no brain. This is not Playwright: runtime tests live in `packages/runtime/e2e` (ADR 0018). See
`docs/qa/TESTING.md` for which change runs which layer.
