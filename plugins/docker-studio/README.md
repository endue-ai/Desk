# plugins/docker-studio

`endue.docker-studio`, Docker Studio: a graphical client for the Docker engine, in the community folder
format and on the public SDK only. Where `endue.docker` is a keyboard-first list, Docker Studio is the
engine in one window: a sidebar of sections (Dashboard, Containers, Images, Volumes, Networks, Compose,
Builds, Explore images, Contexts), a top bar with search and the page's actions, and a status bar with
the engine, resource use and disk. The dashboard shows CPU and memory over time, the busiest containers,
what needs attention (with a diagnosis by AI), the stacks, disk use and the latest events.

Every read and change is the docker program through `proc.spawn` without a shell (`ui/run.js`), the
context as `--context`, `--` before every positional value. Lists are one `ls` and one `inspect` each
(`ui/engine.js`); `docker events` keeps them current and `docker stats` streams resource use while a
page shows it (`ui/live.js`). `Mod+Alt+K` opens it.

| Permission | Why |
| --- | --- |
| `proc:spawn` (`docker`) | Run the docker program, and only it (Compose is `docker compose`) |
| `brain:ask` | Diagnose failures, explain logs, write Dockerfiles |
| `shell:open` (`http`, `https`) | Open a published port in the browser |
| `cmd:invoke` (`endue.terminal.run`, `desk.files.open`) | A shell in a container; open a Compose file |

| File | Purpose |
| --- | --- |
| `ui/run.js`, `errors.js` | docker over the bridge; its failures in words |
| `ui/parse*.js`, `model.js`, `format.js` | What docker prints, as models; states and sizes in words |
| `ui/store.js`, `engine.js`, `live.js` | The state; the lists; events and resource use |
| `ui/studio.js`, `pages.js`, `commands.js` | The window put together; the pages; the commands |
| `ui/view-*.js`, `chart.js`, `overlay.js`, `dom.js` | The views, figures, dialogs and menus; `style*.css` theme tokens only |
| `dev/` | The preview outside the desk: a seeded engine, the SDK shim, screenshots |

```bash
pnpm exec vitest run plugins/docker-studio
node plugins/docker-studio/dev/serve.mjs          # http://127.0.0.1:4327/ on the seeded engine
node plugins/docker-studio/dev/serve.mjs --real   # on the docker program of this machine
```
