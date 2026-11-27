# plugins/local-models

`endue.local-models`, Local models: a client for the language models on this computer, in the community
folder format, on the public SDK only (`Mod+Alt+M`). It finds the servers running here (Ollama, llama.cpp's
and other OpenAI-compatible servers on their usual ports) and the ones added, and runs `.gguf` files itself
with llama.cpp's `llama-server`: headers read for what each file is, load settings per file, a check of
what fits in memory. Discover searches Hugging Face, suggests the quantization that fits, and downloads it
with curl (resumable) or pulls it into Ollama; only searches and downloads go online. Chats are threads
kept as files, answers streaming in as markdown over `net.connect` sockets with their reasoning folded,
speed and token counts, every version kept; questions edited, answers corrected or continued, chats
branched, named by their model and exported. The inspector (`Mod+.`) holds each chat's preset, system
prompt, sampling, context, reasoning switch, JSON output and stop strings; the composer meters context.
Images go to models that see; text files go whole, or, when long, their passages closest to each
question are found with an embedding model (vectors kept in `rag/`) and shown as the question's sources.

| Permission | Why |
| --- | --- |
| `net:connect` (`localhost`, `127.0.0.1`) | Talk to local model servers. Add and Retry review the exact remote address for a lasting grant (ADR 0382) |
| `net:fetch` (`huggingface.co`) | Search models and read catalog files from Discover and agent commands |
| `proc:spawn` (`llama-server`, `curl`, `sysctl`, `nvidia-smi`) | Run model files, download them, read this computer's memory |
| `fs:read`, `fs:write` (`${home}/**`) | Threads, presets and model files under `~/.endue/local-models/`, and the folders added |
| `shell:open` (`http`, `https`) | Open a link from an answer in the browser |

| File | Purpose |
| --- | --- |
| `ui/net.js`, `http.js`, `streams.js` | Sockets through the bridge, HTTP over them, event streams and NDJSON |
| `ui/servers.js`, `ollama.js`, `openai.js`, `models.js` | Finding servers, each API, models as the window shows them |
| `ui/app.js`, `run.js`, `edit.js`, `state.js`, `store.js`, `threads.js`, `think.js` | State, answers, edits, files, threads as trees of versions, inline reasoning |
| `ui/presets.js`, `sampling.js`, `controls.js`, `context.js` | Presets (yours in `presets.json`), the inspector's controls, the context count |
| `ui/gguf.js`, `library.js`, `memory.js`, `proc.js`, `engine.js`, `local.js` | GGUF headers, the model files, fits, programs, llama-server |
| `ui/hub.js`, `downloads.js`, `attach.js`, `rag.js` | Hugging Face; downloads and pulls; attachments; passages |
| `ui/view-*.js`, `message.js`, `markdown.js`, `highlight.js`, `menu.js` | The window, messages, markdown and code colours |
| `dev/` | The preview: `serve.mjs`, the SDK shim, made-up servers and llama-server, GGUF files, `shot.mjs` |

```bash
pnpm exec vitest run plugins/local-models
node plugins/local-models/dev/serve.mjs   # http://127.0.0.1:4340/?fresh; --real for the servers running here
```
