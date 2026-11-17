---
status: accepted
date: 2026-11-18
decision-makers: Team endue
---

# Local models talks to model servers over the bridge's sockets, runs `llama-server` itself, and goes online only for Hugging Face

## Context and Problem Statement

People run language models on their own computer: through Ollama, llama.cpp's server or another
OpenAI-compatible server, or as `.gguf` files with nothing serving them. The desk's brain (ADR 0094)
is one model for Eris; a person who wants to chat with, compare and tune the models on their machine
needs a client of its own. A plugin frame cannot fetch another origin, the servers stream their
answers, a model file has to be started by something, and finding a model means going online.

## Decision Drivers

* On the public SDK and the bridge only, in the community folder format (rule 9)
* Nothing the person types leaves the computer: only searching and downloading models go online
* A streamed answer is drawn as it comes, and a stop stops it
* Threads, presets and model files are plain files the person can read and move

## Considered Options

* HTTP over the bridge's `net.connect` sockets, `llama-server` started through `proc.spawn`
* `net.fetch` to localhost
* A Rust model runner in the core

## Decision Outcome

Chosen option: HTTP/1.1 over `net.connect` sockets (`localhost` and `127.0.0.1`; another computer is
asked for once), because `net.fetch` answers a whole body and cannot stream or be stopped part way,
and a runner in the core would grow the core by an inference engine. `.gguf` files run with
llama.cpp's `llama-server` through `proc.spawn` (`llama-server`, plus `curl` for resumable downloads
and `sysctl` / `nvidia-smi` to read memory), one server per loaded file on a free port. `net:fetch`
reaches `huggingface.co` only, from Discover. Threads are trees of versions in
`~/.endue/local-models/threads/*.json`, presets in `presets.json`, embedding vectors in `rag/`;
`fs:read` and `fs:write` cover `${home}/**` so the folders the person adds for model files can be read
and downloads written where they choose.

### Consequences

* Good, because answers stream, stop at once and keep their reasoning, speed and token counts.
* Good, because every server the person runs speaks to the same window, and a bare file runs too.
* Bad, because the plugin carries an HTTP/1.1 client of its own (`ui/http.js`, `streams.js`).
* Bad, because `fs` over the whole home folder is wider than the plugin's own folder; the grant is
  asked for, and a narrower scope would need a grant per added folder.
* Bad, because the engine is checked against the preview's made-up `llama-server` only; a real
  binary was not run here.

## More Information

Plugin: `plugins/local-models` (README; the audit row in `docs/qa/TESTING.md`). Builds on ADR 0094
(the desk's brain stays the desk's) and the socket bridge `net.connect`.
