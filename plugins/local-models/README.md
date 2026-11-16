# plugins/local-models

`endue.local-models`, Local models: a client for the language models that run on this computer, in the
community folder format, on the public SDK only. It finds the model servers already running here
(Ollama on :11434, llama.cpp's server and other OpenAI-compatible servers on their usual ports), and
the ones the person adds (another port, a computer on the network, a key). It lists their models with
what each is and can do, and chats with them: threads kept as files, answers streaming in as markdown
with their reasoning folded, their speed and token counts, every version of an answer kept. Questions are
edited as new versions, answers corrected or continued, a chat started from any message, named by its
model, and exported as Markdown or JSON (`Mod+Alt+M`).

Requests are HTTP/1.1 over `net.connect` sockets (`ui/http.js`), so tokens show as the server writes
them; plugin frames cannot reach other origins themselves, and nothing goes to the internet.

| Permission | Why |
| --- | --- |
| `net:connect` (`localhost`, `127.0.0.1`) | Talk to the model servers on this computer; another computer is asked for once |
| `fs:read`, `fs:write` (`${home}/**`) | Threads under `~/.endue/local-models/` |
| `shell:open` (`http`, `https`) | Open a link from an answer in the browser |

| File | Purpose |
| --- | --- |
| `ui/net.js`, `http.js`, `streams.js` | Sockets through the bridge, HTTP over them, event streams and NDJSON |
| `ui/servers.js`, `ollama.js`, `openai.js`, `models.js` | Finding servers, each API, models as the window shows them |
| `ui/app.js`, `run.js`, `edit.js`, `state.js`, `store.js`, `threads.js`, `think.js` | State, answers, edits, files, threads as trees of versions, inline reasoning |
| `ui/view-*.js`, `message.js`, `markdown.js`, `highlight.js`, `menu.js` | The window, messages, markdown and code colours |
| `dev/` | The preview: `serve.mjs`, the SDK shim, made-up Ollama and llama.cpp servers, `shot.mjs` |

```bash
pnpm exec vitest run plugins/local-models
node plugins/local-models/dev/serve.mjs   # http://127.0.0.1:4340/?fresh; --real for the servers running here
```
