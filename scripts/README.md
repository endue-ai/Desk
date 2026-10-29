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

`lanes.mjs` decides which Task issues may run in parallel (`just lanes`, `just task-start`), and
`worktree.sh` gives each task its own worktree (ADR 0015). `sync-rulesets.sh` applies
`.github/rulesets/*.json`; maintainers run it by hand, like `sync-labels.sh`.
