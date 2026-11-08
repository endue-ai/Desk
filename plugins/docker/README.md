# plugins/docker

`endue.docker`, the containers, Compose stacks, images, volumes and networks of the engine the docker
program reaches, in the community folder format and on the public SDK only. It opens on an overview
(ADR 0114): the engine, containers by state, stacks, the busiest, disk use with what is reclaimable.
Tabs `1`–`6` (Overview, Containers, Compose, Images, Volumes, Networks); each list has a search (`/`,
`is:running project:shop port:8080`), chips and a sort (`S`, `Z`). Containers show live CPU, memory and
network sparklines from one `docker stats` stream and ports as links. `Space` marks, and `s x r P K D`
act on every mark, one docker call each. `↵` opens the detail pane beside the list: Info, Logs, Stats,
Env, Ports, Inspect (a JSON tree) and Files (`ls` inside, `docker cp` out with `y`, in with `Y`);
images get History, and pulls (`U`) and builds (`B`) stream into it with progress. `[` `]` switch
tabs, `q` closes, `?` lists the keys. Every operation is a command (`endue.docker.*`, with an argument
schema; agents get `ui/tools.js`'s reads and actions, ADR 0088); `Mod+Shift+K` is `endue.docker.open`.

docker runs through `proc.spawn` without a shell (ADR 0039), `--context` when picked, every name and path checked
(`refs.js`, `files.js`, `images.js`) and `--` before positional values; `docker events` keeps the screen current
and turns failures into notifications. What cannot be undone asks first (`desk.palette.pick`); secrets stay masked.
Drag and drop (ADR 0119, `dnd.js`, `drop.js`): paths dropped on a container or its Files tab ask which folder, then
`docker cp` each in with progress. Rows drag `desk/json` `docker/container` or `docker/image` with the id as text; a Files entry drags `docker/file` `{ container, path, name, kind }` with `container:/path`, which a folder target copies with `endue.docker.copy-out { container, path, dest }`.

| Permission | Why |
| --- | --- |
| `proc:spawn` (`docker`) | Run the docker program, and only it (Compose is `docker compose`) |
| `cmd:invoke` (pick, buffers, `desk.files.open`, `endue.terminal.run`) | Ask, be buffers, open a Compose file, a shell |
| `ui:notify` | Say when a container fails, runs out of memory or turns unhealthy |
| `shell:open` (`http`, `https`) | Open a published port in the browser |

| Files | Purpose |
| --- | --- |
| `run.js`, `errors.js`, `refs.js` | docker over the bridge, its errors in words, every value checked |
| `parse-*.js`, `inspect.js`, `images.js`, `files.js`, `stats.js` | What docker prints, as models |
| `overview.js`, `query.js`, `prefs.js`, `bulk.js`, `preview.js` | The overview; search, sort; bulk; prune previews |
| `actions*.js`, `logs.js`, `watch.js`, `live.js` | Actions; logs; events and alerts |
| `docker*.js`, `shelf.js`, `pane.js`, `commands*.js`, `schemas*.js`, `dnd.js`, `drop.js` | The controller, the pane, the commands, drags and drops |
| `view*.js`, `tree.js`, `keys.js`, `dom.js`, `sparkline.js`, `*.css` | The DOM, from `--desk-*` tokens only |

```bash
pnpm exec vitest run plugins/docker
cargo run -p desk-cli -- plugin validate plugins/docker
```
