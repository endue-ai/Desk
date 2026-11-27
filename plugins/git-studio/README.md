# plugins/git-studio

`endue.git-studio`, Git Studio: a graphical Git client in the community folder format, on the public SDK
only. Where `endue.git` is a keyboard-first status buffer, Git Studio is the repository in one window:
the commit graph of every branch with the work in progress on top; the sidebar's branches, remotes, tags,
stashes and worktrees; a panel with the selected commit or the working copy and its composer. In the
centre: diffs (unified or side by side, words marked, hunks and lines staged), the conflict tool (ours,
theirs, the output, by hand or with AI), a file's history and blame. Right-click anything for its
operations; drop a branch on another to merge or rebase; Mod+Z undoes the last move of HEAD.

Open **Origin** to see open and recent pull or merge requests, nested prerequisites, recent CI runs
with hover or keyboard job details, and releases. Create, close, reopen and merge requests, and
publish, edit or delete releases after review. Use `gh auth login` for github.com or `glab auth login`
for gitlab.com. Both CLIs need to be on Desk's PATH when used. Publishing uses an existing remote tag.

Every local operation is the git program through `proc.spawn` without a shell (`ui/run.js`, `endue.git`'s
runner), `--` before paths. No `fs:*` grant: files are read and written through git (conflicts resolve
with `hash-object` and `update-index`). AI is `brain.ask` with a tool per question (`ui/ai.js`).
Commands `endue.git-studio.*` serve the palette and Eris. `Mod+Alt+Shift+G` opens the window.
`state`, `log`, `diff`, `show`, `blame-data` and `file-log` return bounded data. The command registry
also exposes index, stash, branch, tag and history operations. Agents push only a single branch to a
configured remote and pull with an explicit strategy or fast-forward only. Push, branch and stash
deletion, discard, hard reset and proceeding with a paused operation use command approval (ADR 0384).

| Permission | Why |
| --- | --- |
| `proc:spawn` (`git`) | Run the git program, and only it, in the repository |
| `proc:spawn` (`gh`, `glab`), `shell:open` (HTTPS) | Read and manage the selected origin and open provider pages |
| `brain:ask` | Write commit messages, explain commits, suggest conflict resolutions, describe branches |

| File | Purpose |
| --- | --- |
| `ui/run.js`, `repo.js`, `history.js` | git over the bridge; the reads: snapshot, commit, diff, file log, blame, deep search |
| `ui/app.js`, `actions*.js`, `menus.js`, `commands*.js` | State without DOM; what clicks, menus and commands do |
| `ui/studio.js`, `features*.js`, `center.js` | The window put together; conflict, history, blame, AI |
| `ui/view-*.js`, `diff-*.js`, `overlay.js`, `dom.js` | The views, dialogs and menus; `style*.css` theme tokens only |

```bash
pnpm exec vitest run plugins/git-studio
```
