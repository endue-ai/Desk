# scripts

Scripts that `justfile` recipes call (codegen, sign, release). Run them through `just`, not directly.

`docs-i18n.mjs` checks that each user-facing document has its ja, zh, fr, de and ko translations under
`docs/i18n/<lang>/`, linked both ways; its test runs with the other script tests in `just test-unit`.

`lanes.mjs` decides which Task issues may run in parallel (`just lanes`, `just task-start`), and
`worktree.sh` gives each task its own worktree (ADR 0015). `sync-rulesets.sh` applies
`.github/rulesets/*.json`; maintainers run it by hand, like `sync-labels.sh`.

`os-declarations.mjs` checks that the app tells each OS what its features need: the macOS microphone
sentence and entitlements (microphone, virtualization) and ALSA for Linux packages
(`just os-declarations`, run by the release workflow; see `docs/os-permissions.md`).

`release-config.mjs` and `release-assets.mjs` belong to `.github/workflows/release.yml`: the first prints
what a release build adds to `tauri.conf.json` (updater key and endpoint, Windows signing), the second
names the signed bundles and writes `latest.json` (`just release-config`, `just release-assets`;
ADR 0021, `docs/release.md`).
