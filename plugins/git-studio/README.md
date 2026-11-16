# plugins/git-studio

`endue.git-studio`, Git Studio: a graphical Git client in the community folder format, on the public
SDK only. Where `endue.git` is a keyboard-first status buffer, Git Studio is the whole repository in one
window: the commit graph of every branch with the work in progress on top, the sidebar's branches, remotes,
tags, stashes and worktrees, and a panel with the selected commit or the staging area.

Every operation is the git program run through `proc.spawn` without a shell (`ui/run.js`, the same runner
as `endue.git`), `--` before paths, `GIT_TERMINAL_PROMPT=0`. No `fs:*` grant: files are read and written
through git itself.

| Permission | Why |
| --- | --- |
| `proc:spawn` (`git`) | Run the git program, and only it, in the repository |

| File | Purpose |
| --- | --- |
| `ui/run.js` | git over the bridge: spawn, output by process id, timeout, cancel |
| `ui/parse.js`, `parse-status.js` | Refs, log records, stashes, worktrees, changed files, porcelain v2 status |
| `ui/graph.js` | The lane layout: per-row segments, so rows draw themselves (virtualised) |
| `ui/repo.js`, `ops.js` | The reads (a snapshot in parallel, a commit) and the writes, as git arguments |
| `ui/app.js` | The controller without DOM: state, selection, `act` (say, refresh) |
| `ui/studio.js` | The window put together: views, hooks, keys, commands |
| `ui/view-*.js`, `refs.js`, `dom.js`, `icons.js` | Toolbar, sidebar, graph, detail; pills; DOM helpers; icons |
| `ui/style*.css` | Theme tokens only (`--desk-*`; lanes are `chart-1…8`) |
| `dev/` | The preview outside the desk: `serve.mjs`, the SDK shim, a demo repository, screenshots |

```bash
pnpm exec vitest run plugins/git-studio
node plugins/git-studio/dev/demo-repo.mjs /tmp/gs && node plugins/git-studio/dev/serve.mjs --repo /tmp/gs/lumen
```
