# The one command entry point for people, CI and AI agents. See AGENTS.md.

set shell := ["bash", "-euo", "pipefail", "-c"]

# Between folders in DESK_PLUGIN_DIRS and DESK_DEV_PLUGINS, as in PATH
path_sep := if os_family() == "windows" { ";" } else { ":" }

# The dev plugins `just dev` loads when DESK_DEV_PLUGINS names none
dev_examples := (justfile_directory() / "examples/plugin-hello-ui") + path_sep + (justfile_directory() / "examples/plugin-hello-view")

# List recipes
default:
    @just --list

# Build and run the desk (the CEF shell, ADR 0143) in development: built-in plugins from plugins/ and,
# as dev plugins, the folders in DESK_DEV_PLUGINS, else plugin-hello-ui and plugin-hello-view; saving
# a plugin file reloads only that plugin
dev: build-shell
    #!/usr/bin/env bash
    set -euo pipefail
    export DESK_PLUGIN_DIRS="{{justfile_directory()}}/plugins"
    export DESK_DEV_PLUGINS={{quote(env("DESK_DEV_PLUGINS", dev_examples))}}
    if [ "$(uname -s)" = Darwin ]; then exec target/bundle/endue-desk.app/Contents/MacOS/endue-desk; fi
    exec target/debug/endue-desk

# `just dev`, by the name it had while the Tauri shell was the default (Stage 1 of #32)
alias dev-shell := dev

# Run examples/<name> inside the desk in compositor mode, with the built-in plugins: a native plugin
# (`just example plugin-native-wgpu`, #59) is built for this machine first
example name: build-shell
    #!/usr/bin/env bash
    set -euo pipefail
    node scripts/example.mjs build {{quote(name)}}
    export DESK_PLUGIN_DIRS="{{justfile_directory()}}/plugins"
    export DESK_DEV_PLUGINS={{quote(justfile_directory() / "examples" / name)}}
    export DESK_COMPOSITOR=1
    if [ "$(uname -s)" = Darwin ]; then exec target/bundle/endue-desk.app/Contents/MacOS/endue-desk; fi
    exec target/debug/endue-desk

# Run examples/brain-echo, the smallest brain, where the app's echo brain looks (http://127.0.0.1:8787/v0)
brain-echo port="8787":
    node examples/brain-echo/server.mjs --port {{port}}

# All tests: unit and runtime e2e
test: test-unit test-e2e

# Unit, contract and integration tests: Rust crates, TypeScript and repository scripts
test-unit:
    cargo test --all-targets --all-features
    pnpm exec vitest run
    node --test scripts/*.test.mjs

# Runtime tests in headless Chromium on the browser bridge stub, four workers at most; Playwright
# arguments pass through (`just test-e2e e2e/shell.spec.ts --update-snapshots`; ADR 0018, ADR 0144)
[positional-arguments]
test-e2e *args:
    node scripts/e2e.mjs test "$@"

# Static checks: formatting, lints, types, workflows, specs and the theme market (not the CEF shell)
check:
    cargo fmt --all -- --check
    cargo clippy --all-targets --all-features -- -D warnings
    pnpm exec biome ci .
    pnpm exec tsc -p tsconfig.json
    @if command -v actionlint >/dev/null; then actionlint; else echo "actionlint not installed: skipped here, CI runs it"; fi
    node scripts/spec-lint.mjs
    node scripts/ui-lint.mjs
    node scripts/ds-lint.mjs
    node scripts/theme-market.mjs
    pnpm exec spectral lint specs/brain/v0/openapi.yaml --fail-severity=warn --quiet

# Build the CEF shell (ADR 0143) with the web runtime it serves; on macOS also assemble
# target/bundle/endue-desk.app (the CEF framework and its helper apps)
build-shell: build-sdk build-ui
    pnpm --filter @endue-ai/desk-app build
    cargo build -p desk-shell --bins
    @# A fresh bundle each time: macOS kills a signed binary that was rewritten in place (SIGKILL at launch).
    @if [ "$(uname -s)" = Darwin ]; then rm -rf target/bundle/endue-desk.app && cargo run -q -p desk-shell --features bundle --bin desk-shell-bundle -- target/bundle debug; fi

# Lint and test the CEF shell crate, which downloads and builds CEF (so `just check` leaves it out);
# it embeds the plugin SDK and the UI bundle, so those build first
check-shell: build-sdk build-ui
    cargo clippy -p desk-shell --all-targets --all-features -- -D warnings
    cargo test -p desk-shell

# App e2e: WebdriverIO on the CEF desk (`just build-shell` first) through chromedriver on its remote
# debugging port, one app and fresh HOME per spec file; arguments pass to wdio. macOS, Linux under a
# display (`xvfb-run`), Windows (ADR 0144)
[positional-arguments]
test-app-e2e *args:
    pnpm exec wdio run e2e/wdio.conf.ts "$@"

# Install smoke: launch the CEF desk's build with a temp HOME, wait 60 s for the ready line, quit it
# with SIGTERM. Given a package (`just package-shell` makes them), install that and check its
# signatures and sizes first. Linux under a display, macOS, Windows
[positional-arguments]
smoke *package:
    e2e/smoke/install-and-launch.sh "$@"

# Package the CEF desk for this machine with cargo-packager (#46, ADR 0145): the pinned CEF (fetched
# and hash-checked into ~/.cache/desk/cef), a release build against it, then the .app, .dmg and
# .app.tar.gz (macOS), NSIS and MSI (Windows) or .deb and AppImage (Linux) in
# target/packager/<triple>/bundle. Ad-hoc signed on macOS unless APPLE_SIGNING_IDENTITY is set
package-shell version="0.0.0": build-sdk build-ui
    #!/usr/bin/env bash
    set -euo pipefail
    triple="$(rustc -vV | sed -n 's/^host: //p')"
    CEF_PATH="$(node scripts/cef-fetch.mjs --target "$triple")"
    export CEF_PATH
    pnpm --filter @endue-ai/desk-app build
    # Linux: the desk finds libcef.so beside itself.
    if [ "$(uname -s)" = Linux ]; then export RUSTFLAGS='-C link-arg=-Wl,-rpath,$ORIGIN'; fi
    cargo build -p desk-shell --bins --release
    node scripts/cef-package.mjs --target "$triple" --version "{{version}}"

# Generate Rust and TypeScript types from specs/ (deterministic; CI checks for drift)
codegen:
    node scripts/codegen.mjs

# Render the API reference from specs/ into a folder (the docs site builds it; never committed)
docs-api out:
    node scripts/spec-docs.mjs {{out}}

# Bundle the plugin SDK that the app serves to plugin frames
build-sdk:
    pnpm --filter @endue-ai/plugin-sdk build

# Bundle @endue-ai/ui (its elements and the two sheets) that the app serves to plugin frames under
# /_desk/, and refresh the committed copy of the generated tokens.css the shell imports
build-ui:
    pnpm --filter @endue-ai/ui build
    cp packages/ui/dist/tokens.css packages/ui/src/tokens.css

# Copy the terminal plugin's emulator (xterm.js and its addons) from the pinned npm packages into
# plugins/terminal/ui/vendor; scripts/vendor-xterm.test.mjs checks the copy matches (ADR 0037)
vendor-terminal:
    node scripts/vendor-xterm.mjs

# Copy the Screen Sharing plugin's VNC client (noVNC's core and the pako files it imports) from the
# pinned npm package into plugins/screens/ui/vendor/novnc; scripts/vendor-novnc.test.mjs checks it (ADR 0133)
vendor-novnc:
    node scripts/vendor-novnc.mjs

# Measure the opening frame time (pass "record" to make it the new baseline in e2e/perf/budgets.json).
# Headless Chromium, one worker (ADR 0144); record on a quiet machine
perf-opening mode="check":
    node scripts/e2e.mjs perf {{mode}}

# WebdriverIO on the CEF desk as in `just test-app-e2e`, results in e2e/test-results/perf, baselines in
# e2e/perf/budgets.json; nightly in the e2e workflow's perf job. Measure the app's start-up, idle
# memory and input latency ("record" sets the baselines)
perf-app mode="check":
    PERF_MODE={{mode}} pnpm exec wdio run e2e/perf/wdio.conf.ts

# The compositor's budgets (#58): the compose bench (15 surfaces at 1440p within 4 ms, the compositor's
# start) and the CEF desk's surface probe (memory per live surface against #35, the start to the first
# composed web surface), judged against e2e/perf/budgets.json; results in e2e/test-results/perf-compositor.
# `just build-shell` once first; a quiet machine ("record" sets the baselines)
perf-compositor mode="check":
    node e2e/perf/compositor.ts {{mode}}

# The motion gate (#247, ADR 0208): the optimized shell (development commands on) on the Default
# profile's 13 plugin windows, one shaken by its title bar at 2 Hz ±200 px, a move every 8 ms, headless
# (no screen, pointer or keyboard of the machine's), three runs; fails on dropped frames, a window
# showing pixels not its own, a page that stops painting, a window softer at rest than at a whole
# pixel. Then the sway (#258, ADR 0213): the app window grown and shrunk on a sine (±300×±200 points, a
# frame every 8 ms) while that window shakes, judged on the pictures' sizes, the desk's own page and the
# windows once it rests. Last the resize loop (#248, ADR 0210): the app window resized by four sizes and
# a plugin window maximized or restored, a turn every 100 ms for 100 turns, judged on pages that stop
# painting and restarts. Limits, known failures and the baseline in e2e/perf/motion.json ("record" sets
# the baseline); `--debug` measures the development build for the record, `--screen` presents to the
# window, `--runs N`, `--no-build`. macOS. Run it before every window change lands (docs/qa/TESTING.md)
[positional-arguments]
perf-motion *args: build-sdk build-ui
    node e2e/perf/motion.ts "$@"

# Check that this session still has its macOS login session (a WindowServer crash ends it; ADR 0018)
doctor:
    node scripts/doctor.mjs

# Parallel tasks (ADR 0015): show lanes, or pick the ready issues that can start now ("next")
lanes *args="status":
    node scripts/lanes.mjs {{args}}

# For every repository under ~/Project/endue (`--root <folder>` for another); `--block '<text>'` adds a
# personal string to refuse, kept in this machine's config only. Sessions and task-start check it too.
# Install the commit identity endue-team and its hooks on this machine (AGENTS.md, Boundaries)
[positional-arguments]
identity *args:
    scripts/git-identity/install.sh "$@"

# Claim an ai:ready issue and start it in .claude/worktrees/ai-<issue> on ai/<issue>-<slug>, identity first
task-start issue:
    node scripts/doctor.mjs
    scripts/git-identity/ensure.sh
    branch="$(node scripts/lanes.mjs claim {{issue}})" && scripts/worktree.sh start {{issue}} "$branch"

# Remove task worktrees whose PR merged and that hold no uncommitted work
task-gc:
    scripts/worktree.sh gc
