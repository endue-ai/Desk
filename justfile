# The one command entry point for people, CI and AI agents. See AGENTS.md.

set shell := ["bash", "-euo", "pipefail", "-c"]

# List recipes
default:
    @just --list

# Run the desktop app in development mode
dev:
    @echo "not yet: just dev arrives with apps/desk"

# Unit tests: Rust, TypeScript and repository scripts
test:
    cargo test --workspace --all-targets
    pnpm exec vitest run
    node --test scripts/*.test.mjs

# Static checks: formatting, lints, types and workflows
check:
    cargo fmt --all -- --check
    cargo clippy --workspace --all-targets -- -D warnings
    pnpm exec biome ci .
    pnpm exec tsc -p tsconfig.json
    @if command -v actionlint >/dev/null; then actionlint; else echo "actionlint not installed: skipped here, CI runs it"; fi

# Generate Rust and TypeScript types from specs/
codegen:
    @echo "not yet: codegen arrives with specs v0"
