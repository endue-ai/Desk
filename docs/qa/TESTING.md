# Testing

Which tests run for which change, and where they live. The layers come from the design
(`docs/ko/desk-structure.md`, "QA: 테스트 층"). Layers are switched on when they have something real to
catch; until then they are marked "not yet".

## Layers

| Layer | What it checks | Tool and location | When | Status |
| --- | --- | --- | --- | --- |
| Static | fmt, clippy `-D warnings`, biome, tsc strict, actionlint; spec lint and licences later | `just check` | every PR (`ci`) | active (spec lint: not yet) |
| Unit | functions and modules | `cargo test`, vitest (`*.test.ts`), `node --test` for `scripts/` | every PR (`ci`) | active |
| Acceptance validity | tests a PR adds or changes fail on the base commit | `scripts/red-on-base.sh`, job `red-on-base` | every PR except `kind:refactor` | active |
| Scope | changed files inside the issue Scope; As-is → To-be table complete | `scripts/scope-check.mjs`, workflow `scope-check` | every PR | active |
| Security | cargo deny, cargo audit, pnpm audit, gitleaks | workflow `security`, `deny.toml` | every PR, main, weekly | active |
| Review | table vs diff, contract, tests verify behaviour, permissions, 400-line rule | workflow `review` (needs `ANTHROPIC_API_KEY`) | code PRs | active when the key is set |
| Contract | `specs/*/vectors` pass on both Rust and TS; brain conformance against brain-echo | `crates/desk-brain/tests/conformance.rs`, `packages/bridge` tests | every PR | not yet |
| Integration (Rust) | permission engine, plugin host lifecycle, VM lifecycle, session leases | `crates/*/tests` | every PR (VM: main and nightly) | not yet |
| Runtime (web) | 2D compositor rendering, surfaces, input routing, layout restore, opening snapshots | Playwright + browser bridge stub, `packages/runtime/e2e` | PR on Linux; main and nightly on 3 OSes | not yet |
| App e2e | first run, plugin install, permission prompts, layouts, updater | WebdriverIO + tauri-driver, `e2e/specs` (Linux, Windows) | after merge, `e2e/` or `plugins/` PRs, nightly | not yet |
| Install smoke | install, launch, ready log, signature check, quit | `e2e/smoke` | every canary, beta and stable build | not yet |
| Performance budgets | startup, idle memory, opening frame time, VM boot | `e2e/perf/budgets.json` | nightly | not yet |

## Which change runs what

| You change | Runs on the PR |
| --- | --- |
| `crates/**` | `ci` (fmt, clippy, cargo test), `red-on-base` (new `crates/*/tests`), `security` |
| `packages/**`, `apps/**/src`, `plugins/**` | `ci` (biome, tsc, vitest), `red-on-base` (new `*.test.ts`), `security` |
| `scripts/**` | `ci` (biome, `node --test`) |
| `.github/workflows/**` | `ci` (actionlint) |
| `specs/**` | `ci`; codegen drift and contract tests: not yet |
| `docs/**`, `*.md` | `ci`, `scope-check`; `review` skips them |
| any PR | `scope-check`, `labeler` |

## Rules

- Tests live next to the source. Acceptance tests for a task go in `crates/<crate>/tests/` or `*.test.ts`
  so red-on-base can run them on the base commit; inline Rust tests are reported but not checked there.
- Animations run on an injected clock and randomness takes a seed. Snapshots are taken at fixed times.
- Test hooks (`desk.test.*`) exist only behind the `test-hooks` feature, never in release builds.
- A test that still flakes after three retries gets the `quarantine` label and an issue. Quarantined
  tests do not block merges but keep running nightly.
