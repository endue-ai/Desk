# Handoff: focus rings and the agent bar's New agent / New space

Work in progress on branch `ai/focus-rings-and-bar-new` (from `origin/main` at 21b7200d). Delete this
file before the branch becomes a PR. No issue exists for it yet.

## The request (Korean, from the maintainer)

1. A focused window shows a blue ring round its body and a purple ring round Eris's history. Remove
   both: they are bad UX.
2. Build the left agent bar like endue.ai's web left bar: "+N more" as a circle of the hidden agents'
   faces with its name under it, a dashed round "+" named "New agent", a dashed rounded-square "+"
   named "New space".

## Done (committed, not built or tested yet)

- **Blue ring (`#4c8dff`)**: the CEF shell's compositor drew it round the plugin pane with the keys.
  Removed: `register()` in `apps/desk/shell/src/compositor_window/input.rs` no longer takes
  `frames`/`groups` or draws a ring; `compose.rs` calls it with two arguments; `Drawn::groups`
  is gone (`draw.rs`); `overlay::focus_ring`, `RING`, `draw_pixels::{Ring, ring_of}` and their tests are
  gone. The overlay test "neither mark takes the pointer" became "the drag image takes no pointer".
  Doc comments in `draw_anchor.rs`, `draw_anchor_tests.rs` and `composed_pane.rs` no longer mention the
  ring. `cargo fmt -p desk-shell` ran.
- **Purple ring**: `#conversation:focus-visible` in `plugins/eris/ui/style.css` now has
  `outline: none`; the say row's controls keep theirs.
- **Agent bar**: new `packages/runtime/src/shell/bar-new.ts` with `moreControl`, `newAgentControl`,
  `newSpaceControl`, `openNewAgent`, `barWord` (own ko/en words, to stay out of `copy.ts`).
  Wired into `SideBar.ts` (signed out: faces get no colour) and `SideBarEndue.ts` (signed in: faces
  take `personalColor`). New agent is last in the agents' group, New space last in the spaces'.
  - New agent: `desk.plugins.open {plugin: "endue.agents"}`, then `endue.agents.new` retried 20 × 150
    ms; on failure `showOnDesk(ctx, "https://endue.ai/agents/new")`.
  - New space: `showOnDesk(ctx, "https://endue.ai/spaces/new")` (no create-space bridge method exists).

## To do

1. **Kit classes for ds-lint**: add `icon-button` to the more control's class and `add-button` to
   the two new controls in `bar-new.ts`, or `node scripts/ds-lint.mjs` counts three new bare buttons.
2. **`packages/runtime/src/shell/bar-new.css`** (new), imported in `shell/styles.ts` after
   `../system/system.css`; tokens only (ui-lint). Planned:
   - `.float-bar .bar-labeled`: column flex, centred, gap 2px, width = bar inside its border
     (`calc(var(--bar-width) - 2px)`), height auto, no border, transparent (also on hover, over the
     kit's `.icon-button:hover:not(:disabled)`), muted ink, text on hover.
   - `.bar-labeled .bar-face`: `var(--bar-avatar)` square, round, grid centred; hover fill
     `var(--desk-hover)`. `.bar-new-agent .bar-face` dashed 1px `var(--desk-input)` round;
     `.bar-new-space .bar-face` the same with `var(--bar-button-radius)`.
   - `.bar-more-faces`: 1px `var(--desk-border)` circle on `var(--desk-card)`, a 2 × 2 grid of
     `.bar-more-face` dots (~11px, gap 2px; one face alone larger, the third of three spanning both
     columns), each `background: var(--face-colour, var(--desk-chart-N))` with N = 1..4 by
     `:nth-child`.
   - `.bar-caption`: `var(--text-2xs)`, weight 500, centred, at most two lines
     (`-webkit-line-clamp: 2`, `word-break: keep-all`): "New agent" does not fit one line at 52 wide.
   - Remove `.float-bar .avatar-more` from `system.css` (the control is no longer an `.avatar`).
3. **Agents plugin command**: `plugins/agents/plugin.json` contributes `endue.agents.new` ("Agents:
   New agent", no `runs`); `plugins/agents/ui/main.js` adds
   `ctx.commands.on("endue.agents.new", () => on().create())` after `createApp`; update
   `plugins/agents/tests/manifest.test.ts` (it pins the command list).
4. **Tests**: `SideBar.test.ts` "past six agents…" expects `.avatar-more` text `+2`; it is now
   `+2 more`. Add tests for New agent / New space (keys `agents-new`, `spaces-new`, names "Create a new
   agent" / "Create a new space", the commands they run). `packages/runtime/e2e/shell-system.spec.ts`
   expects `toHaveText("+3")`: now `+3 더보기`.
5. **Snapshots**: `packages/runtime/e2e/__snapshots__/shell.spec.ts/{default,light,working}.json` and
   `shell-a11y.spec.ts/reduced-motion.json` change (two new buttons, the more control). They hold
   laid-out boxes: regenerate with `just test-e2e` on a machine where it runs (not macOS 12; see #301).
6. **Docs**: the headers of `SideBar.ts`/`SideBarEndue.ts`; `docs/qa/TESTING.md` rows 194–195
   mention the focus ring; `packages/runtime/README.md` if it lists the bar's parts.
7. **Checks**: `just check`, `just test-unit`, `just check-shell` (clippy + tests for `desk-shell`).
   The compositor change needs `just perf-motion` green (AGENTS.md boundary; macOS 13+). Nothing ran
   yet: the clippy run was stopped unfinished.

## Watch out

- Issue #294 (the agent bar unfolds, worktree `.claude/worktrees/ai-294`) is in flight and rewrites
  `SideBar.ts`, `SideBarEndue.ts`, `chrome.css`, `system.css`, `copy.ts` and the same snapshots.
  Expect conflicts; this branch keeps its own code in `bar-new.ts` to keep them small.
- Reference design: endue.ai web `src/widgets/leftSidebar` (`AgentList.tsx`, `SpaceList.tsx` and
  their `.module.scss`). Closed code: read it, copy nothing.
