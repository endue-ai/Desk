# Handoff: focus rings and the agent bar's New agent / New space

Work in progress on branch `ai/focus-rings-and-bar-new` (from `origin/main` at 21b7200d). Delete this
file before the branch becomes a PR. No issue exists for it yet.

## The request (Korean, from the maintainer)

1. A focused window shows a blue ring round its body and a purple ring round Eris's history. Remove
   both: they are bad UX.
2. Build the left agent bar like endue.ai's web left bar: "+N more" as a circle of the hidden agents'
   faces with its name under it, a dashed round "+" named "New agent", a dashed rounded-square "+"
   named "New space".

## Done (committed; nothing built or tested yet: see "To do")

- **Blue ring (`#4c8dff`)**: the CEF shell's compositor drew it round the plugin pane with the keys.
  Removed: `register()` in `apps/desk/shell/src/compositor_window/input.rs` no longer takes
  `frames`/`groups` or draws a ring; `compose.rs` calls it with two arguments; `Drawn::groups`
  is gone (`draw.rs`); `overlay::focus_ring`, `RING`, `draw_pixels::{Ring, ring_of}` and their tests are
  gone. The overlay test "neither mark takes the pointer" became "the drag image takes no pointer".
  Doc comments in `draw_anchor.rs`, `draw_anchor_tests.rs` and `composed_pane.rs` no longer mention the
  ring; nor do `docs/qa/TESTING.md`'s compositor rows. Read for dangling imports and fields by hand
  (no Rust toolchain on the second machine); `cargo fmt` was applied by hand to `overlay.rs`.
- **Purple ring**: `#conversation:focus-visible` in `plugins/eris/ui/style.css` now has
  `outline: none`; the say row's controls keep theirs.
- **Agent bar** (`packages/runtime/src/shell/bar-new.ts`, `bar-new.css`): `moreControl` (up to four
  of the hidden agents' faces over "+N more"), `newAgentControl`, `newSpaceControl`, `openNewAgent`,
  `barWord` (own ko/en words, to stay out of `copy.ts`). Kit classes for ds-lint (`icon-button`,
  `add-button`), overridden by `.float-bar .bar-labeled`. Wired into `SideBar.ts` (signed out: faces
  take the chart colours in turn) and `SideBarEndue.ts` (signed in: faces take `personalColor`).
  `.float-bar .avatar-more` is gone from `system.css`.
  - New agent: `desk.plugins.open {plugin: "endue.agents"}`, then `endue.agents.new` retried 20 × 150
    ms; on failure `showOnDesk(ctx, "https://endue.ai/agents/new")`.
  - New space: `showOnDesk(ctx, "https://endue.ai/spaces/new")` (no create-space bridge method exists).
- **Agents plugin**: `endue.agents.new` ("Agents: New agent", no `runs`) in `plugin.json`, handled in
  `ui/main.js` (`on().create()`); `tests/manifest.test.ts` and the README say it.
- **Tests**: `bar-new.test.ts` (new); `SideBar.test.ts` expects `+2 more` and two faces;
  `e2e/shell-system.spec.ts` expects `+3 더보기`. `docs/qa/TESTING.md` lists `bar-new.test.ts`.

## Verified (dongsoolee's Mac, macOS 26.2, 2026-11-15)

- `cargo fmt --all -- --check`, `biome ci .`, `tsc -p tsconfig.json`, `ui-lint`, `ds-lint`: clean.
- vitest: `packages/runtime/src/{shell,system,surface,wallpaper}`, `core/keys.test.ts`,
  `plugins/{agents,eris}`, `e2e/perf/lib`: 79 files, 503 tests pass. (`plugins/agents/tests/
  manifest.test.ts` passes alone; under a load average of 60 its first test overran vitest's 5 s.)
- `just check-shell`: clippy `-p desk-shell --all-targets --all-features -D warnings` passes (CEF's
  wrapper needs `cmake` and `ninja`: now in `~/.local/bin` on that Mac).
- `just test-e2e`: `shell-bars`, `account-bar`, `arrange`, `shell-sizes`, `eris` and the snapshot tests
  of `shell` and `shell-a11y` pass; the render trees `shell.spec.ts/{default,light,working}.json` and
  `shell-a11y.spec.ts/reduced-motion.json` were rewritten by that run, the agent bar's subtree alone.
- Failing on `main` as well, with the same symptoms (checked in a worktree of `21b7200d`):
  `shell-a11y.spec.ts:123` (`.surface × .rail` at 1024 wide), `shell-system.spec.ts:47` and
  `shell.spec.ts:183` (30 s timeouts), `shell-eris.spec.ts:20,33` (timeouts under load). #301's lane.

## To do

1. `cargo test -p desk-shell` (the second half of `just check-shell`).
2. `just perf-motion` for the compositor change (AGENTS.md boundary). It needs a quiet machine: it
   fails under 55 fps, and three sessions were building at once there.
3. **Look at it** in `just dev`: caption sizes in a 52 wide bar ("새 에이전트" breaks after "새"),
   the dashed faces, "+N more" with one to four faces, light and dark. Then decide whether the words
   move into `copy.ts` once #294 lands.
4. Open the PR (issue to file first, or none), and delete this file before it.

## Watch out

- Issue #294 (the agent bar unfolds, worktree `.claude/worktrees/ai-294`) is in flight and rewrites
  `SideBar.ts`, `SideBarEndue.ts`, `chrome.css`, `system.css`, `copy.ts` and the same snapshots.
  Expect conflicts; this branch keeps its own code in `bar-new.ts` to keep them small.
- Reference design: endue.ai web `src/widgets/leftSidebar` (`AgentList.tsx`, `SpaceList.tsx` and
  their `.module.scss`). Closed code: read it, copy nothing.
