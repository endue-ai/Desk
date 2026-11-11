# plugins/git

`endue.git`, a keyboard-first front for Git, in the community folder format and on the public SDK only.
One `center` surface shows a repository's status (head, unmerged, untracked, unstaged, staged, stashes,
recent commits), its log as a graph of lanes, and diffs; single letters do the work (`s` stage,
`u` unstage, `k` discard, `c` commit, `l` log, `d` diff, `f`/`F`/`P` fetch/pull/push, `b` switch),
`?` lists them all and `q` goes back. A start of the desk reopens the repository opened last.
Every operation is a command (`endue.git.*`), so the palette, Eris and agents run the same ones;
`Mod+Shift+G` is `endue.git.status`. Agents get `endue.git.state` (the repository as data) and the
operations as tools (ADR 0088); push and discard wait for the person's approval. Design and requirements: `docs/ko/git-plugin-requirements.md`.

Git runs through `proc.spawn` without a shell, `--` before every path, `GIT_TERMINAL_PROMPT=0` so a
missing credential fails at once instead of waiting. What cannot be undone (discard, force push) asks
first through `desk.palette.pick`, on "Keep everything as it is". Failures are said in git's own words on a status line and in the
desk's notice. Until the core serves `proc.*` (#77) the status line says so.

In the palette (`Mod+K`) the Branches group (`endue.git.branches`, a `paletteProviders` entry) lists the
open repository's local and remote branches whose names hold the typed words. Enter runs
`endue.git.checkout` with the branch, the same `git switch` as `b`: git refuses to overwrite
uncommitted changes, and nothing is forced.

| Permission | Why |
| --- | --- |
| `proc:spawn` (`git`) | Run the git program, and only it, in the repository |
| `cmd:invoke` (`desk.files.open`, `desk.palette.pick`, `desk.buffers.open`, `desk.buffers.update`) | Open a file, ask the person to pick or confirm, be a buffer for the log and diff views |

| File | Purpose |
| --- | --- |
| `ui/run.js` | git over the bridge: spawn, gather output by process id, timeout, cancel, one ask on refusal |
| `ui/parse-status.js`, `parse-log.js`, `parse-diff.js` | Porcelain v2, log records and the lane layout, unified diffs |
| `ui/actions.js` | Stage, unstage, discard, commit (editor), fetch, pull, push, switch, open |
| `ui/branches.js` | The branches `for-each-ref` lists, for the switch pick and the palette's Branches group |
| `ui/git.js` | The repository, the views as desk buffers, the commands and the desk's requests |
| `ui/view*.js`, `keys.js` | The DOM: a tree with a cursor and folding, the graph SVG, the editor, the keys |
| `ui/style.css` | The look, from the theme's `--desk-*` tokens only: lanes and changes are `chart-*` (`tests/theme.test.ts`) |

```bash
pnpm exec vitest run plugins/git
cargo run -p desk-cli -- plugin validate plugins/git
```
