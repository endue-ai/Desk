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

`ui-lint.mjs` (in `just check`) keeps every UI on the theme's tokens: no literal colours, fonts, text
sizes, radii or durations outside `theme: content` marks, as a ratchet over
`ui-lint-baseline/<target>.json` (`docs/design-system.md`, ADR 0056). Its test runs in `just test-unit`.
