# plugins/git

`endue.git`, a keyboard-first front for Git, in the community folder format and on the public SDK only.
One `center` surface shows a repository's status, its log as a graph of lanes, and diffs; single letters
do the work (`s` stage, `u` unstage, `k` discard, `c` commit, `l` log, `d` diff, `f`/`F`/`P`
fetch/pull/push, `b` switch), `?` lists them all, `q` goes back. In a diff `s`, `u` and `k` take the hunk
under the cursor or the lines `v` marked; the patch goes to `git apply -` on stdin (ADR 0248). A start
reopens the last repository. Every operation is a command (`endue.git.*`, `Mod+Shift+G` the status), so
the palette, Eris and agents run the same ones; agents also get `endue.git.state` (ADR 0088), and push
and discard wait for the person. Design: `docs/ko/git-plugin-requirements.md`.

Git runs through `proc.spawn` without a shell, `--` before every path, `GIT_TERMINAL_PROMPT=0` so a
missing credential fails at once. A discard or force push asks first through `desk.palette.pick`, on
"Keep everything as it is"; a discarded hunk or lines go back with the desk's undo. Failures are said in
git's own words on a status line and in the desk's notice.

In the palette (`Mod+K`) the Branches group (`endue.git.branches`) lists the open repository's branches
whose names hold the typed words; Enter runs `endue.git.checkout`, the same `git switch` as `b`: git
refuses to overwrite uncommitted changes, and nothing is forced.

| Permission | Why |
| --- | --- |
| `proc:spawn` (`git`) | Run the git program, and only it, in the repository |
| `cmd:invoke` (`desk.files.open`, `desk.palette.pick`, `desk.buffers.open`, `desk.buffers.update`, `endue.git.discard-patch`) | Open a file, ask the person to pick or confirm, be a buffer for the log and diff views, discard part of a file so the desk's undo puts it back |

| File | Purpose |
| --- | --- |
| `ui/run.js` | git over the bridge: spawn, gather output by process id, timeout, cancel, one ask on refusal |
| `ui/parse-status.js`, `parse-log.js`, `parse-diff.js` | Porcelain v2, log records and the lane layout, unified diffs |
| `ui/actions.js` | Stage, unstage, discard, commit (editor), fetch, pull, push, switch, open |
| `ui/hunks.js`, `patch.js` | A hunk or chosen lines: the patch, `git apply -`, a discard the desk can undo |
| `ui/branches.js` | The branches `for-each-ref` lists, for the switch pick and the palette's Branches group |
| `ui/git.js`, `pick.js` | The repository, the views as desk buffers, the commands and the desk's requests |
| `ui/view*.js`, `keys.js` | The DOM: a tree with a cursor and folding, the graph SVG, the editor, the keys |
| `ui/style.css` | The look, from the theme's `--desk-*` tokens only: lanes and changes are `chart-*` (`tests/theme.test.ts`) |

```bash
pnpm exec vitest run plugins/git
cargo run -p desk-cli -- plugin validate plugins/git
```
