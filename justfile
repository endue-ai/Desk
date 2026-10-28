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

# All tests: unit and runtime e2e
test: test-unit test-e2e

# Unit, contract and integration tests: Rust crates, TypeScript and repository scripts
test-unit:
    cargo test --all-targets --all-features
    pnpm exec vitest run
    node --test scripts/*.test.mjs

# Runtime tests in WebKit on the browser bridge stub (once: pnpm --filter @endue-ai/runtime exec playwright install webkit)
test-e2e:
    pnpm --filter @endue-ai/runtime exec playwright test

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
check-app: build-sdk
    pnpm --filter @endue-ai/desk-app build
    cargo clippy -p desk-app --all-targets -- -D warnings

# Build the Tauri app binary
build-app: build-sdk
    pnpm --filter @endue-ai/desk-app build
    cargo build -p desk-app

# Generate Rust and TypeScript types from specs/ (deterministic; CI checks for drift)
codegen:
    node scripts/codegen.mjs

# Bundle the plugin SDK that the app serves to plugin frames
build-sdk:
    pnpm --filter @endue-ai/plugin-sdk build
