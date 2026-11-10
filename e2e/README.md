# e2e

App-level tests that drive the desktop app: what the browser stub cannot show, such as the first run,
plugins and the session across a relaunch. They drive the CEF desk over Chromium's remote debugging
(ADR 0144); the Tauri app stays reachable with `DESK_E2E_SHELL=tauri` until Stage 1 of #32 ends.

| Path | Purpose |
| --- | --- |
| `wdio.conf.ts` | WebdriverIO: one app process per spec file, each with a fresh `HOME`; `DESK_E2E_SHELL` picks `cef` (default) or `tauri` |
| `specs/` | On the desk shell, Default profile: `launch` (both layers, ready line, first run, Skip intro), `plugins` (the Plugins list toggled from the keyboard), `session` (the dock and the desktop switcher across a relaunch), `themes` (user themes in the data folder: one the runtime saves with `theme.save` and one copied into `themes/` by hand, both listed after a relaunch), `safe-mode` (two starts left at `starting` in last-start.json make the third safe mode, ADR 0061), `settings` (init.yaml values that fail their settings: ready line, the default theme, both lines named on the log, ADR 0080), `persist` (an always grant from `e2e.ask` and the brain picked in the rail survive a relaunch, #351), `desk-folder` (a desk exported with `desk export --with-data`, emptied and imported comes back with the same profiles, bindings, views and plugins, #288), `crash` (a shell error writes a crash report with HOME as `~`, the next start shows its card once, #322) |
| `support/` | `driver.ts` starts the spec's driver and app (chromedriver and the CEF desk, or tauri-driver); `cef.ts` launches the CEF desk with `DESK_REMOTE_DEBUGGING_PORT` and waits for its ready line; `chrome-for-testing.ts` fetches the pinned chromedriver and the runtime e2e's headless shell; `desk.ts` holds the specs' helpers; `cli.ts` builds and runs the `desk` CLI with the spec's HOME |
| `driver/` | `chrome-for-testing.json`: Chrome for Testing's chromedriver and headless shell for the app's Chromium, by platform, with each zip's SHA-256; `webkit-webdriver.sh`: the Tauri path's native driver, with the app's stdout kept for the log |
| `fixtures/` | `init.yaml` (the template), `init-no-first-run.yaml`, `init-bad-values.yaml` (two values that fail their settings), the `e2e.hello` test plugin, `e2e.ask` (perm.request buttons; `persist` loads it), the `local.e2e-paper` user theme (`theme-e2e-paper`) |
| `smoke/` | `install-and-launch.sh` (the CEF desk's build; the Linux .deb with `DESK_E2E_SHELL=tauri`), `verify-signature.sh` (a stub until signing) |
| `perf/` | `budgets.json` (the opening frame-time baseline of `just perf-opening`, and the app's); `just perf-app`: `startup` (a second start with six surfaces saved, from `DESK_TRACE=1`'s trace), `memory` (RSS 5 min after start), `latency` (palette and focus switch, p95 of 20); `lib/` the pure parts, unit tested |

## Run

```bash
just build-shell                # the CEF desk's debug build (on macOS its .app bundle)
just test-app-e2e               # all specs; add `--spec e2e/specs/launch.spec.ts` for one
just perf-app                   # e2e/perf, results in e2e/test-results/perf; `record` sets baselines
just smoke                      # build, launch, ready line, quit
```

macOS, Windows and Linux; Linux needs a display (`xvfb-run -a just test-app-e2e`, as the `e2e` workflow
does). The first run downloads chromedriver into `~/.cache/desk/chromedriver` and checks its SHA-256;
`DESK_CHROMEDRIVER` names another binary, `DESK_APP` another app. Only debug builds open the debugging
port. A relaunch (`browser.reloadSession()`) ends the page, quits the app and starts it again with the
same HOME and port. With `DESK_E2E_SHELL=tauri` the recipes drive `just bundle-app`'s release build
through tauri-driver 2.1.0 and `webkit2gtk-driver`, on Linux only (ADR 0006). Logs, the chromedriver's
log and failure screenshots go to `test-results/`.

Each spec starts the app with `HOME` in a temp folder (so the data folder and the engine's storage
start empty), `DESK_INIT` on a fixture, `DESK_PLUGIN_DIRS=plugins/`, `DESK_DEV_PLUGINS` on the test
plugin and no brain. This is not Playwright: runtime tests live in `packages/runtime/e2e` (ADR 0018). See
`docs/qa/TESTING.md` for which change runs which layer.
