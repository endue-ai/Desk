# plugins/docker

`endue.docker`, the containers, Compose projects, images, volumes and networks of the engine the docker
program reaches, in the community folder format and on the public SDK only. One `center` surface holds
six lists (`1`–`6`), a container's detail and its logs as desk buffers; single letters do the work (`s`
start, `x` stop, `r` restart, `P` pause, `K` kill, `D` remove, `l` logs, `e` shell, `↵` detail). Every
operation is a command (`endue.docker.*`, registered again with an argument schema for agents), so the
palette, Eris and agents run the same ones; `Mod+Shift+K` is `endue.docker.open`. Design and
requirements: `docs/ko/docker-plugin-requirements.md`; why the CLI and not the socket: ADR 0039.

docker runs through `proc.spawn` without a shell, with `--context` when the person picked one, every
name checked (`ui/refs.js`) and `--` before positional values. `docker events` keeps the lists current;
a container that fails on its own, runs out of memory or turns unhealthy is a desk notification. What
cannot be undone (kill, remove, down, prune) asks first through `desk.palette.pick`. Secret-looking
environment values stay masked. A shell opens in the terminal plugin (`endue.terminal.run`).

| Permission | Why |
| --- | --- |
| `proc:spawn` (`docker`) | Run the docker program, and only it (Compose is `docker compose`) |
| `cmd:invoke` (`desk.palette.pick`, `desk.buffers.open`, `.update`, `desk.files.open`, `endue.terminal.run`) | Ask and confirm, be buffers, open a Compose file, open a shell |
| `ui:notify` | Say when a container fails, runs out of memory or turns unhealthy |

| File | Purpose |
| --- | --- |
| `ui/run.js`, `errors.js` | docker over the bridge: runs, streams, timeouts, cancel, the PATH fallback; its errors in words |
| `ui/parse-list.js`, `parse-engine.js`, `inspect.js` | The JSON templates and what they print; `container inspect` as sections |
| `ui/refs.js` | Names, OCI image references, ports, env, volumes, restart policies, `docker run` arguments |
| `ui/actions.js`, `actions-more.js` | Containers and images; volumes, networks, Compose and clean-up |
| `ui/logs.js`, `watch.js`, `live.js` | Logs that follow; the event stream and alerts; refreshes and resource use |
| `ui/docker.js`, `engine.js`, `lists.js`, `desk.js`, `commands.js`, `schemas.js` | The controller, its reads, the desk's commands and the plugin's |
| `ui/view*.js`, `keys.js`, `dom.js` | The DOM: tabs, a tree with a cursor and folding, the logs pane, the keys |

```bash
pnpm exec vitest run plugins/docker
cargo run -p desk-cli -- plugin validate plugins/docker
```
