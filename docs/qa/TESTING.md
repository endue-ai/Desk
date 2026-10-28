# Testing

Which tests run for which change, and where they live. The layers come from the design
(`docs/ko/desk-structure.md`, "QA: 테스트 층"). Layers are switched on when they have something real to
catch; until then they are marked "not yet".

## Layers

| Layer | What it checks | Tool and location | When | Status |
| --- | --- | --- | --- | --- |
| Static | fmt, clippy `-D warnings`, biome, tsc strict, actionlint, spec lint (Ajv strict compile of every schema, spectral for the OpenAPI) | `just check` | every PR (`ci`) | active |
| Codegen drift | `just codegen` reproduces the committed generated files | job `codegen-check` | every PR | active |
| Unit | functions and modules | `cargo test`, vitest (`*.test.ts`), `node --test` for `scripts/` | every PR (`ci`) | active |
| Acceptance validity | tests a PR adds or changes fail on the base commit | `scripts/red-on-base.sh`, job `red-on-base` | every PR except `kind:refactor` | active |
| Scope | changed files inside the issue Scope; As-is → To-be table complete | `scripts/scope-check.mjs`, workflow `scope-check` | every PR | active |
| Security | cargo deny, cargo audit, pnpm audit, gitleaks | workflow `security`, `deny.toml` | every PR, main, weekly | active |
| Review | table vs diff, contract, tests verify behaviour, permissions, 400-line rule | workflow `review` (needs `ANTHROPIC_API_KEY`) | code PRs | active when the key is set |
| Contract | `specs/*/vectors` judged the same by Rust (`jsonschema`) and TS (Ajv); valid vectors round-trip through generated types; WIT is a bridge subset | `crates/desk-bridge/tests/{contract,wit}.rs`, `crates/desk-brain/tests/contract.rs`, `packages/bridge/src/contract.test.ts` | every PR | active |
| Brain conformance | `examples/brain-echo` answers as `specs/brain/v0` says: every response and stream event validated against the contract's schemas (formats included), request vectors accepted or refused as their folders say, lease conflicts, a conversation through `HttpBrain` | `crates/desk-brain/tests/conformance.rs` (starts brain-echo with Node) | every PR (`ci`) | active |
| Integration (Rust) | permission engine (deny by default, grant, revoke, path scope), event bus, `Core::handle`, fs primitives, plugin registry (install, crash isolation, persisted flags, file serving, hot reload), `desk plugin validate`, session leases against brain-echo (acquire, release, expiry, takeover), `brain.say` (streamed turns, the echo tool, offline and resume, read-only after a takeover, the session across a restart); later Wasm host, VM | `crates/*/tests` | every PR (VM: main and nightly) | active (Wasm host, VM: not yet) |
| Runtime (web) | 2D compositor render trees (ADR 0011), layout restore after reload, shortcut routing, UI plugins (mount, bridge round trip, isolated hot reload with state, enable/disable), the first run (six render-tree snapshots on a fake clock: 3.0 s, 8.8 s, 19.3 s, name + 2.4 s, Skip, reduced motion; every branch; ADR 0013), Eris poses, talking to Eris (the typed line rising, the answer streaming as soul text, offline and resume, turns routed only to their caller), desk edges (render tree with the built-in chrome; a bar leaves with its last surface), the dock (tiles, put away and bring back, arrow keys) and the toolbar (drawers from the keyboard, a failed plugin's warning, the open drawer across a reload) | Playwright (WebKit) + browser bridge stub, `packages/runtime/e2e`, `just test-e2e` | every PR on Linux (`runtime-e2e`) | active |
| Plugin validation | every `plugin.json` in `plugins/` and `examples/` matches specs/plugin v0 and its entry exists | `desk plugin validate`, workflow `plugin-validate` | PRs touching `plugins/**` or `examples/**`, and main | active |
| App build | the Tauri app compiles and passes clippy on Linux, macOS and Windows | `just check-app`, `just build-app`, job `app-build` | PRs touching `apps/desk/src-tauri/**` or `crates/desk-sys/**`, and main | active |
| App e2e | first run, plugin install, permission prompts, layouts, updater | WebdriverIO + tauri-driver, `e2e/specs` (Linux, Windows) | after merge, `e2e/` or `plugins/` PRs, nightly | not yet |
| Install smoke | install, launch, ready log, signature check, quit | `e2e/smoke` | every canary, beta and stable build | not yet |
| Performance budgets | opening frame time (p95 frame interval in WebKit, baseline in `e2e/perf/budgets.json`); later startup, idle memory, VM boot | `just perf-opening` (`record` sets the baseline), `packages/runtime/e2e/perf` | by hand now; nightly later, failing past `allowedRegression` | opening: active; others: not yet |

## Which change runs what

| You change | Runs on the PR |
| --- | --- |
| `crates/**` | `ci`: fmt, clippy, cargo test on Linux, macOS and Windows; `red-on-base` (new `crates/*/tests`); `security` |
| `apps/desk/src-tauri/**`, `crates/desk-sys/**` | the above plus `app-build` on all three OSes |
| `packages/**`, `apps/**/src`, `plugins/**` | `ci`: biome, tsc, vitest on three OSes, `runtime-e2e` on Linux; `red-on-base` (new `*.test.ts`); `security` |
| `scripts/**` | `ci` (biome, `node --test`) |
| `.github/workflows/**` | `ci` (actionlint) |
| `specs/**` | `ci` (spec lint, contract tests), `codegen-check`; run `just codegen` and commit the generated files |
| `plugins/**`, `examples/**` | `ci` (biome for plugin JS; `examples/brain-echo` is covered by the Rust conformance and lease tests), `plugin-validate` |
| `docs/**`, `*.md` | `ci`, `scope-check`; `review` skips them |
| any PR | `scope-check`, `labeler`; the required `ci` check is the aggregate of every `ci` job above |
| in the merge queue | `ci` again on the PR combined with `main` and the PRs ahead of it (no `red-on-base`); `scope-check` reports success (ADR 0015) |

## Rules

- Tests live next to the source. Acceptance tests for a task go in `crates/<crate>/tests/` or `*.test.ts`
  so red-on-base can run them on the base commit; inline Rust tests are reported but not checked there.
- Animations run on an injected clock and randomness takes a seed. Snapshots are taken at fixed times.
- Test hooks (`desk.test.*`) exist only behind the `test-hooks` feature, never in release builds.
- A test that still flakes after three retries gets the `quarantine` label and an issue. Quarantined
  tests do not block merges but keep running nightly.
