# The one command entry point for people, CI and AI agents. See AGENTS.md.

set shell := ["bash", "-euo", "pipefail", "-c"]

# List recipes
default:
    @just --list

# Run the desktop app in development mode: built-in plugins from plugins/, plugin-hello-ui as a
# dev plugin; saving a plugin file reloads only that plugin's surface
dev:
    DESK_PLUGIN_DIRS="{{justfile_directory()}}/plugins" \
    DESK_DEV_PLUGINS="{{justfile_directory()}}/examples/plugin-hello-ui" \
    pnpm --filter @endue-ai/desk-app tauri dev

# Run examples/brain-echo, the smallest brain, where the app looks by default (http://127.0.0.1:8787/v0)
brain-echo port="8787":
    node examples/brain-echo/server.mjs --port {{port}}

# All tests: unit and runtime e2e
test: test-unit test-e2e

# Unit, contract and integration tests: Rust crates, TypeScript and repository scripts
test-unit:
    cargo test --all-targets --all-features
    pnpm exec vitest run
    node --test scripts/*.test.mjs

# Runtime tests in WebKit on the browser bridge stub; Playwright arguments pass through (`just test-e2e
# --update-snapshots`). macOS runs them in a Linux container, two runs per machine at most (ADR 0018)
test-e2e *args:
    node scripts/e2e.mjs test {{args}}

# Static checks: formatting, lints, types, workflows and specs (the Tauri app has its own recipe)
check:
    cargo fmt --all -- --check
    cargo clippy --all-targets --all-features -- -D warnings
    pnpm exec biome ci .
    pnpm exec tsc -p tsconfig.json
    @if command -v actionlint >/dev/null; then actionlint; else echo "actionlint not installed: skipped here, CI runs it"; fi
    node scripts/spec-lint.mjs
    pnpm exec spectral lint specs/brain/v0/openapi.yaml --fail-severity=warn --quiet

# Lint the Tauri app crate (needs the platform webview SDK)
check-app: build-sdk build-ui
    pnpm --filter @endue-ai/desk-app build
    cargo clippy -p desk-app --all-targets -- -D warnings

# Build the Tauri app binary
build-app: build-sdk build-ui
    pnpm --filter @endue-ai/desk-app build
    cargo build -p desk-app

# The release build the app e2e and the install smoke drive: target/release/endue-desk and
# the Linux .deb in target/release/bundle/deb/ (Linux only)
bundle-app: (_not-macos "bundle-app" "builds the Linux .deb only; the e2e workflow runs it on Linux")
    pnpm --filter @endue-ai/desk-app tauri build --bundles deb

# App e2e: WebdriverIO + tauri-driver on the bundled app (`just bundle-app` first), one app and
# fresh HOME per spec file, under a display (`xvfb-run`); arguments pass to wdio. Linux (ADR 0006)
test-app-e2e *args: (_not-macos "test-app-e2e" "tauri-driver does not run on macOS (ADR 0006); the e2e workflow runs it on Linux")
    pnpm exec wdio run e2e/wdio.conf.ts {{args}}

# Install smoke: build and install the .deb (apt, sudo), launch it with a temp HOME, wait 60 s for
# the ready line, quit it with SIGTERM. Linux, under a display
smoke: (_not-macos "smoke" "the install smoke covers the Linux .deb only; the e2e workflow runs it on Linux")
    e2e/smoke/install-and-launch.sh

# Refuse with one line and exit 2 on macOS, where the recipe's tools do not run
[no-exit-message]
_not-macos recipe reason:
    @if [ "$(uname -s)" = Darwin ]; then echo "{{recipe}}: {{reason}}" >&2; exit 2; fi

# Generate Rust and TypeScript types from specs/ (deterministic; CI checks for drift)
codegen:
    node scripts/codegen.mjs

# Render the API reference from specs/ into a folder (the docs site builds it; never committed)
docs-api out:
    node scripts/spec-docs.mjs {{out}}

# Bundle the plugin SDK that the app serves to plugin frames
build-sdk:
    pnpm --filter @endue-ai/plugin-sdk build

# Bundle @endue-ai/ui (its elements and tokens) that the app serves to plugin frames at /_desk/ui.js
build-ui:
    pnpm --filter @endue-ai/ui build

# Copy the terminal plugin's emulator (xterm.js and its addons) from the pinned npm packages into
# plugins/terminal/ui/vendor; scripts/vendor-xterm.test.mjs checks the copy matches (ADR 0037)
vendor-terminal:
    node scripts/vendor-xterm.mjs

# Measure the opening frame time (pass "record" to make it the new baseline in e2e/perf/budgets.json).
# Native WebKit with the machine to itself; on macOS for people only (ADR 0018)
perf-opening mode="check":
    node scripts/e2e.mjs perf {{mode}}

# Check that this session still has its macOS login session (a WindowServer crash ends it; ADR 0018)
doctor:
    node scripts/doctor.mjs

# Parallel tasks (ADR 0015): show lanes, or pick the ready issues that can start now ("next")
lanes *args="status":
    node scripts/lanes.mjs {{args}}

# Claim an ai:ready issue and start it in .claude/worktrees/ai-<issue> on ai/<issue>-<slug>
task-start issue:
    node scripts/doctor.mjs
    branch="$(node scripts/lanes.mjs claim {{issue}})" && scripts/worktree.sh start {{issue}} "$branch"

# Remove task worktrees whose PR merged and that hold no uncommitted work
task-gc:
    scripts/worktree.sh gc
