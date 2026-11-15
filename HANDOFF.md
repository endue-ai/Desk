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

## To do

1. **Run everything once** (none of it has run): `just check` (biome, tsc, ui-lint, ds-lint, docs),
   `just test-unit`, `just check-shell` (clippy + tests for `desk-shell`). The compositor change needs
   `just perf-motion` green (AGENTS.md boundary; macOS 13+).
2. **Snapshots**: `packages/runtime/e2e/__snapshots__/shell.spec.ts/{default,light,working}.json` and
   `shell-a11y.spec.ts/reduced-motion.json` change (two new buttons, the more control). They hold
   laid-out boxes: regenerate with `just test-e2e` on a machine where it runs (not macOS 12; see #301).
3. **Look at it** in `just dev`: caption sizes in a 52 wide bar, the dashed faces, "+N more" with one
   to four faces, light and dark. Then decide whether the words move into `copy.ts` once #294 lands.
4. Open the PR (issue to file first, or none), and delete this file before it.

## Watch out

- Issue #294 (the agent bar unfolds, worktree `.claude/worktrees/ai-294`) is in flight and rewrites
  `SideBar.ts`, `SideBarEndue.ts`, `chrome.css`, `system.css`, `copy.ts` and the same snapshots.
  Expect conflicts; this branch keeps its own code in `bar-new.ts` to keep them small.
- Reference design: endue.ai web `src/widgets/leftSidebar` (`AgentList.tsx`, `SpaceList.tsx` and
  their `.module.scss`). Closed code: read it, copy nothing.
