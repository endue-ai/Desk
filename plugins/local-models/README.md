# plugins/local-models

`endue.local-models`, Local models: a client for the language models that run on this computer, in the
community folder format, on the public SDK only. It finds the model servers already running here
(Ollama on :11434, llama.cpp's server and other OpenAI-compatible servers on their usual ports), and
the ones the person adds (another port, a computer on the network, a key). It lists their models with
what each is and can do, and chats with them: threads kept as files, answers streaming in as markdown
with their reasoning folded, their speed and token counts, every version of an answer kept. Questions are
edited as new versions, answers corrected or continued, a chat started from any message, named by its
model, and exported as Markdown or JSON. The inspector (`Mod+.`) holds each chat's preset, system prompt,
sampling, context length, reasoning switch, JSON or schema output and stop strings; the composer shows
how much of the context the chat fills (`Mod+Alt+M`).

Model files (`.gguf`) in `~/.endue/local-models/models` and the folders added are read for what they are
from their headers and run by the built-in engine, llama.cpp's `llama-server`, with each file's load
settings (context, GPU layers, threads, cache type, flash attention) and a check of what fits in memory.

Requests are HTTP/1.1 over `net.connect` sockets (`ui/http.js`), so tokens show as they are written.

| Permission | Why |
| --- | --- |
| `net:connect` (`localhost`, `127.0.0.1`) | Talk to the model servers on this computer; another computer is asked for once |
| `proc:spawn` (`llama-server`, `sysctl`, `nvidia-smi`) | Run model files; read this computer's memory |
| `fs:read`, `fs:write` (`${home}/**`) | Threads, presets and model files under `~/.endue/local-models/`, and the folders added |
| `shell:open` (`http`, `https`) | Open a link from an answer in the browser |

| File | Purpose |
| --- | --- |
| `ui/net.js`, `http.js`, `streams.js` | Sockets through the bridge, HTTP over them, event streams and NDJSON |
| `ui/servers.js`, `ollama.js`, `openai.js`, `models.js` | Finding servers, each API, models as the window shows them |
| `ui/app.js`, `run.js`, `edit.js`, `state.js`, `store.js`, `threads.js`, `think.js` | State, answers, edits, files, threads as trees of versions, inline reasoning |
| `ui/presets.js`, `sampling.js`, `controls.js`, `context.js` | Presets (yours in `presets.json`), the inspector's controls, the context count |
| `ui/gguf.js`, `library.js`, `memory.js`, `proc.js`, `engine.js`, `local.js` | GGUF headers, the model files, fits, programs, llama-server |
| `ui/view-*.js`, `message.js`, `markdown.js`, `highlight.js`, `menu.js` | The window, messages, markdown and code colours |
| `dev/` | The preview: `serve.mjs`, the SDK shim, made-up servers and llama-server, GGUF files, `shot.mjs` |

```bash
pnpm exec vitest run plugins/local-models
node plugins/local-models/dev/serve.mjs   # http://127.0.0.1:4340/?fresh; --real for the servers running here
```
