# Testing

Which tests run for which change, and where they live. The layers come from the design
(`docs/ko/desk-structure.md`, "QA: 테스트 층"). Layers are switched on when they have something real to
catch; until then they are marked "not yet".

## Layers

| Layer | What it checks | Tool and location | When | Status |
| --- | --- | --- | --- | --- |
| Static | fmt, clippy `-D warnings`, biome, tsc strict, actionlint, spec lint (Ajv strict compile of every schema, spectral for the OpenAPI) | `just check` | every PR (`ci`) | active |
| Codegen drift | `just codegen` reproduces the committed generated files | job `codegen-check` | every PR | active |
| Unit | functions and modules; the e2e runner's slots, modes and Playwright guard, the session doctor and the agent hook (ADR 0018) | `cargo test`, vitest (`*.test.ts`), `node --test` for `scripts/` | every PR (`ci`) | active |
| Acceptance validity | tests a PR adds or changes fail on the base commit | `scripts/red-on-base.sh`, job `red-on-base` | every PR except `kind:refactor` | active |
| Scope | changed files inside the issue Scope; As-is → To-be table complete | `scripts/scope-check.mjs`, workflow `scope-check` | every PR | active |
| Security | cargo deny, cargo audit, pnpm audit, gitleaks | workflow `security`, `deny.toml` | every PR, main, weekly | active |
| Review | table vs diff, contract, tests verify behaviour, permissions, 400-line rule | workflow `review` (needs `ANTHROPIC_API_KEY`) | code PRs | active when the key is set |
| Contract | `specs/*/vectors` judged the same by Rust (`jsonschema`) and TS (Ajv); valid vectors round-trip through generated types; the init.yaml template parses to its vector in both; WIT is a bridge subset | `crates/desk-bridge/tests/{contract,wit}.rs`, `crates/desk-brain/tests/contract.rs`, `packages/bridge/src/contract.test.ts` | every PR | active |
| Brain conformance | `examples/brain-echo` answers as `specs/brain/v0` says: every response and stream event validated against the contract's schemas (formats included), request vectors accepted or refused as their folders say, lease conflicts, a conversation through `HttpBrain`; the agent directory (agents, A2A cards, spaces, A2A tasks: filters, pages, 400 and 404, through `HttpBrain` too) | `crates/desk-brain/tests/conformance.rs`, `crates/desk-brain/tests/directory.rs` (start brain-echo with Node) | every PR (`ci`) | active |
| Integration (Rust) | permission engine (deny by default, grant, revoke, path scope), event bus, `Core::handle`, fs primitives, plugin registry (install, crash isolation, persisted flags, file serving, hot reload), `desk plugin validate`, init.yaml (template, broken file, plugins held off; `init.get` hands each caller its own settings), policy plugins without an entry, `ui.notify` as `ui.notified`, `fs.write` and `fs.watch` (scopes, folders, events in the caller's paths, watches ended by a revoke), the command registry (`cmd.*`: one provider per id, listing and invoking under `cmd:invoke`, args against their schema, `cmd.invoked` to the provider and `cmd.answered` to the caller, a turned-off plugin's commands dropped and its waiting invocations cancelled) and its sync between two desks through the mock remote (push, pull, conflict and resolve, offline, restart; ADR 0016), session leases against brain-echo (acquire, release, expiry, takeover), `brain.say` (streamed turns, the echo tool, offline and resume, read-only after a takeover, the session across a restart); later Wasm host, VM | `crates/*/tests` | every PR (VM: main and nightly) | active (Wasm host, VM: not yet) |
| Runtime (web) | 2D compositor render trees (ADR 0011), layout restore after reload, shortcut routing, UI plugins (mount, bridge round trip, isolated hot reload with state, enable/disable), the first run, scenes 1-10 (render-tree snapshots on a fake clock: 3.0 s, 6.8 s, 13.8 s, 24.3 s, name + 2.4 s, Skip, reduced motion, first screen + 3.5 s; every branch: microphone, silence, sign-in outcomes, offline, outside the US, Later, a resumed first run; ADR 0013), Eris poses, talking to Eris (the typed line rising, the answer streaming as soul text, offline and resume, turns routed only to their caller), desk edges (render tree with the built-in chrome; a bar leaves with its last surface), the dock (tiles, put away and bring back, arrow keys) and the toolbar (drawers from the keyboard, a failed plugin's warning, the open drawer across a reload), the desk's policies on their real `plugin.json` files (themes from settings and init.yaml in the desk and in frames, keys on the desk and from inside frames, Mod per platform, a disabled policy taking its commands and keys away, one command registry for the desk's built-ins and plugins' commands (through `stubCommands`, the stub's copy of the core's), notifications by level, do not disturb, the palette (keys, filtering, history, picks and cancel), display rules and focus cycling, files through their opener (open, save, unsaved close, changes on disk, a typed path), buffers, the session kept and put back, profiles from init.yaml and switched or saved; ADR 0017); the shell UI on the runtime (profiles, desktops, rail, drawer, composer, surfaces, Eris drag; render-tree snapshots of the default desk, profiles open, working, six Eris states, soul text at 3.0 s, listening at 0.4 s, speaking at 0.3 s, light theme, reduced motion; text contrast in both themes, one lavender fill, no overlap at 1024 px); the system layer (same place in every profile, above the mode layer, Night hides the rail), the agent bar from the agent directory (A2A presence, spaces, overflow, agent screen with its A2A card, offline), surfaces as windows (⌘N, split right and down, dividers by pointer and keys, ⌘W, panes through the drawer), the palette over the shell, command bindings (the person's layer: record, conflicts move, Esc, reset, kept by desk.session) | Playwright (WebKit) + browser bridge stub, `packages/runtime/e2e`, `just test-e2e` (on macOS in Playwright's Linux image, ADR 0018) | every PR on Linux (`runtime-e2e`) | active |
| Plugin validation | every `plugin.json` in `plugins/` and `examples/` matches specs/plugin v0 and its entry exists | `desk plugin validate`, workflow `plugin-validate` | PRs touching `plugins/**` or `examples/**`, and main | active |
| App build | the Tauri app compiles and passes clippy on Linux, macOS and Windows | `just check-app`, `just build-app`, job `app-build` | PRs touching `apps/desk/src-tauri/**` or `crates/desk-sys/**`, and main | active |
| App e2e | first run, plugin install, permission prompts, layouts, updater | WebdriverIO + tauri-driver, `e2e/specs` (Linux, Windows) | after merge, `e2e/` or `plugins/` PRs, nightly | not yet |
| Install smoke | install, launch, ready log, signature check, quit | `e2e/smoke` | every canary, beta and stable build | not yet |
| Performance budgets | opening frame time (p95 frame interval in WebKit, baseline in `e2e/perf/budgets.json`); later startup, idle memory, VM boot | `just perf-opening` (`record` sets the baseline; on macOS people only, native WebKit with the machine to itself), `packages/runtime/e2e/perf` | by hand now; nightly later, failing past `allowedRegression` | opening: active; others: not yet |

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
- Playwright runs only through `just test-e2e` and `just perf-opening` (ADR 0018). On macOS the
  runtime e2e runs in a Linux container, at most two e2e runs share a machine, and native WebKit is
  for people only (`DESK_E2E_NATIVE=1`); the Playwright configs refuse anything else.
- A test that still flakes after three retries gets the `quarantine` label and an issue. Quarantined
  tests do not block merges but keep running nightly.
