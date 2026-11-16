# plugins/docker-studio

`endue.docker-studio`, Docker Studio: a graphical client for the Docker engine beside the keyboard-first
`endue.docker` (ADR 0263), in the community folder format, on the public SDK only. Sections: a Dashboard
(CPU and memory over time, the busiest containers, what needs attention, stacks, disk, events);
Containers by Compose stack, each with Logs, Stats, Files, Exec, Processes, Details and Inspect; Images
with their layers, a Run form, pull, tag and push; Volumes (files read where mounted or by a helper
container) and Networks (a map); Compose stacks with their service map and logs; Builds step by step and
a Dockerfile writer; Explore images (Docker Hub); Contexts; Clean up; Settings. Ask AI (`A`) diagnoses,
explains and suggests through `brain.ask`. Keys: `/` search, `1`–`9` sections, `?` the rest.

Every call is the docker program through `proc.spawn` without a shell (`ui/run.js`), `--` before every
positional value, each value checked (`ui/refs.js`). Lists are one `ls` and one `inspect` each; `docker
events` keeps them current and one `docker stats` stream feeds every chart. AI's commands run only from
`ui/ai-commands.js`'s list, after the person agrees; prompts never carry a variable's value.

| Permission | Why |
| --- | --- |
| `proc:spawn` (`docker`) | Run the docker program, and only it (Compose is `docker compose`) |
| `brain:ask` | Diagnose, explain logs and builds, slim images, tailor Docker files, answer questions |
| `shell:open` (`http`, `https`) | Open a published port in the browser |
| `cmd:invoke` (`endue.terminal.run`, `desk.files.open`) | A terminal in a container; open a Compose file |
| `fs:read`, `fs:write` (`${home}/**`) | Write a Dockerfile into the folder named, asked for that folder alone |

| File | Purpose |
| --- | --- |
| `ui/run.js`, `errors.js`, `refs.js` | docker over the bridge; failures in words; every value checked |
| `ui/parse*.js`, `model.js`, `format.js`, `query.js` | What docker prints, as models; words, sizes, search |
| `ui/store.js`, `engine.js`, `live.js`, `settings.js` | State; the lists; events and stats; settings |
| `ui/actions*.js`, `logs.js`, `files.js`, `images.js`, `compose.js`, `build.js`, `templates.js` | What changes the engine, and each area's model |
| `ui/ai-*.js`, `assistant.js` | brain.ask, prompts and tools, answer cards, suggested commands, the panel |
| `ui/studio.js`, `features.js`, `pages.js`, `commands.js` | The window put together; pages; commands for agents |
| `ui/view-*.js`, `tab-*.js`, `dialog-*.js`, `table.js`, `chart.js`, `overlay.js` | Pages, tabs, dialogs; `style*.css` tokens only |
| `dev/` | The preview: a seeded engine (or `--real`), the SDK shim, demo answers, screenshots |

```bash
pnpm exec vitest run plugins/docker-studio
node plugins/docker-studio/dev/serve.mjs          # http://127.0.0.1:4327/, seeded; ?brain=demo&scheme=light
node plugins/docker-studio/dev/serve.mjs --real   # on this machine's docker program
```
