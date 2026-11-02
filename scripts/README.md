# scripts

Scripts that `justfile` recipes call (codegen, sign, release). Run them through `just`, not directly.

`docs-i18n.mjs` checks that each user-facing document has its ja, zh, fr, de and ko translations under
`docs/i18n/<lang>/`, linked both ways; its test runs with the other script tests in `just test-unit`.

`e2e.mjs` runs Playwright for `just test-e2e` and `just perf-opening` (ADR 0018): natively in CI, in a
Linux container on macOS (`e2e/container.mjs`, `e2e/Dockerfile`), always holding one of the machine's
slots (`e2e/slots.mjs`). `e2e/guard.mjs` runs inside both Playwright configs and refuses native WebKit
on macOS that the runner did not start. `doctor.mjs` (`just doctor`) recognises a login session that
macOS has ended; `agent-hook.mjs` is the Claude Code hook in `.claude/settings.json` that blocks
direct Playwright commands. Their tests run in `just test-unit`.

`vendor-xterm.mjs` (`just vendor-terminal`) copies the terminal plugin's emulator, xterm.js and its
addons, from the pinned npm packages into `plugins/terminal/ui/vendor/` (ADR 0037); its test fails
`just test-unit` when the committed copy differs.

`lanes.mjs` decides which Task issues may run in parallel (`just lanes`, `just task-start`), and
`worktree.sh` gives each task its own worktree (ADR 0015). `sync-rulesets.sh` applies
`.github/rulesets/*.json`; maintainers run it by hand, like `sync-labels.sh`.

`release-version.mjs`, `release-collect.mjs`, `release-manifest.mjs` and `release-publish.mjs` are the
release pipeline's steps (ADR 0054): the build version, each target's bundles under canonical names,
`release.json` and the channel indexes, and the upload to R2 in the order that keeps every listed build
whole. The `release-build`, `canary`, `release`, `promote` and `rollback` workflows call them; their
tests run in `just test-unit`.
