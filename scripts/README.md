# scripts

Scripts that `justfile` recipes call (codegen, sign, release). Run them through `just`, not directly.
`justfile.test.mjs` dry-runs `just dev`: it must load the `DESK_DEV_PLUGINS` folder, else plugin-hello-ui.

`docs-i18n.mjs` checks that each user-facing document has its ja, zh, fr, de and ko translations under
`docs/i18n/<lang>/`, linked both ways; its test runs with the other script tests in `just test-unit`.

`e2e.mjs` runs Playwright for `just test-e2e` and `just perf-opening` (ADR 0018, ADR 0144): headless
Chromium natively on every OS, four workers at most (`e2e/plan.mjs`), holding a run lease outside CI
(`e2e/lease.mjs`). `e2e/guard.mjs` runs inside both Playwright configs and on macOS refuses a run the
runner did not start, and an agent's headed, UI or debug run. `doctor.mjs` (`just doctor`) recognises a login session that
macOS has ended; `agent-hook.mjs` is the Claude Code hook in `.claude/settings.json` that blocks
direct Playwright commands. Their tests run in `just test-unit`.

`vendor-xterm.mjs` (`just vendor-terminal`) copies the terminal plugin's emulator, xterm.js and its
addons, from the pinned npm packages into `plugins/terminal/ui/vendor/` (ADR 0037); its test fails
`just test-unit` when the committed copy differs. `vendor-novnc.mjs` (`just vendor-novnc`) does the same
for the Screen Sharing plugin's VNC client, noVNC, into `plugins/screens/ui/vendor/novnc/` (ADR 0133).

`lanes.mjs` decides which Task issues may run in parallel (`just lanes`, `just task-start`), and
`worktree.sh` gives each task its own worktree (ADR 0015). `sync-rulesets.sh` applies
`.github/rulesets/*.json`; maintainers run it by hand, like `sync-labels.sh`.

`release-version.mjs`, `release-collect.mjs`, `release-manifest.mjs` and `release-publish.mjs` are the
release pipeline's steps (ADR 0054, ADR 0092): the build version of a canary, a line's candidate or its
final, each target's bundles under canonical names, `release.json`, the channel indexes and their rollout
shares, and the upload to R2 in the order that keeps every listed build whole. The `release-build`,
`canary`, `release-cut`, `release`, `release-final`, `rollout` and `rollback` workflows call them
(`docs/releasing.md`).

`ui-lint.mjs` (in `just check`) keeps every UI on the theme's tokens: no literal colours, fonts, text
sizes, radii or durations outside `theme: content` marks, as a ratchet over
`ui-lint-baseline/<target>.json` (`docs/design-system.md`, ADR 0056). Its test runs in `just test-unit`.

`theme-textures.mjs` draws the raster tiles the built-in showcase themes lay behind the desk: a paper tile
for `plugins/theme-paper` and scanlines for `plugins/theme-amber`, one per scheme, from a seeded
generator and `node:zlib` only (no downloads). Run `node scripts/theme-textures.mjs` after changing it and
commit the PNGs; its test, in `just test-unit`, checks that it draws the same bytes twice, writes valid
PNGs and that the committed tiles hold the pixels it draws.

`theme-market.mjs` (`just check`, ADR 0060) checks `market/themes`: an index with unique ids, each bundle
beside it with its sha256, size and licence and a valid theme plugin. Its test runs in `just test-unit`.
