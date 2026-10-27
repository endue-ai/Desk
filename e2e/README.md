# e2e

App-level tests that drive the packaged desktop app.

| Folder | Purpose |
| --- | --- |
| `specs/` | WebdriverIO + tauri-driver specs: onboarding, plugins, permissions, layouts, updater |
| `fixtures/` | Test plugins, folders and brain-echo scenarios |
| `smoke/` | Install and launch, verify signatures (sh, ps1) |
| `perf/` | `budgets.json`, startup, idle memory, opening frames |

Runtime (web) tests live next to the runtime in `packages/runtime/e2e`; unit tests live next to the source.
See `docs/qa/` for which change runs which layer.

Status: `perf/budgets.json` holds the opening frame-time baseline (`just perf-opening`); the rest are
folders only.
