// The built-in engine: a model file loaded by running llama.cpp's `llama-server` on a free local port
// with the person's load settings (context, GPU layers, threads, flash attention, cache type, memory
// locking), followed until it answers /health, then chatted with as any OpenAI-compatible server.
// Each loaded model is one process; ejecting it ends the process. Its log is kept for the window.
import { fetchJson } from "./http.js";

/**
 * @typedef {{
 *   ctx: number,
 *   gpuLayers?: number,
 *   threads?: number,
 *   flashAttention?: boolean,
 *   cacheType?: "f16" | "q8_0" | "q4_0",
 *   mlock?: boolean,
 *   mmap?: boolean,
 *   batch?: number,
 *   parallel?: number,
 *   lan?: boolean,
 * }} LoadConfig
 * @typedef {{
 *   id: string,
 *   path: string,
 *   alias: string,
 *   port: number,
 *   config: LoadConfig,
 *   state: "starting" | "ready" | "failed" | "stopped",
 *   startedAt: number,
 *   error?: string,
 *   progress?: number,
 *   log: string[],
 *   kill: () => Promise<unknown>,
 * }} Instance
 */

export const FIRST_PORT = 39281;
const LOG_LINES = 400;

/** The arguments llama-server gets for a model and its settings. @param {string} path @param {string} alias @param {number} port @param {LoadConfig} c @param {string} [projector] */
export function serverArgs(path, alias, port, c, projector) {
  const args = [
    "-m",
    path,
    "--alias",
    alias,
    "--host",
    c.lan ? "0.0.0.0" : "127.0.0.1",
    "--port",
    String(port),
  ];
  args.push("-c", String(c.ctx));
  if (c.gpuLayers !== undefined) args.push("-ngl", String(c.gpuLayers));
  if (c.threads) args.push("-t", String(c.threads));
  if (c.flashAttention !== undefined) args.push("-fa", c.flashAttention ? "on" : "off");
  if (c.cacheType && c.cacheType !== "f16")
    args.push("--cache-type-k", c.cacheType, "--cache-type-v", c.cacheType);
  if (c.batch) args.push("-b", String(c.batch));
  if (c.parallel) args.push("-np", String(c.parallel));
  if (c.mlock) args.push("--mlock");
  if (c.mmap === false) args.push("--no-mmap");
  if (projector) args.push("--mmproj", projector);
  args.push("--jinja", "--metrics");
  return args;
}

/** How far a load has come, from a line of llama-server's log (its dots, its stages). @param {string} line @param {number} was */
export function progressOf(line, was) {
  const stages = [
    [/server is listening|HTTP server listening.*model|model loaded/i, 1],
    [/llama_context|kv_cache|KV self size|graph_reserve|initializing slots/i, 0.8],
    [/buffer size|offloaded \d+\/\d+ layers/i, 0.55],
    [/llama_model_load|loading model|load_tensors|llama_model_loader/i, 0.15],
  ];
  for (const [re, at] of stages)
    if (/** @type {RegExp} */ (re).test(line)) return Math.max(was, /** @type {number} */ (at));
  return was;
}

/** Words for why llama-server stopped, from its last lines. @param {string[]} log @param {number | undefined} code */
export function failureOf(log, code) {
  const text = log.slice(-40).join("\n");
  if (/address already in use|bind.*failed/i.test(text)) return "The port was taken; try again.";
  if (
    /failed to (allocate|create).*buffer|out of memory|ggml_metal.*error|insufficient memory/i.test(
      text,
    )
  )
    return "Not enough memory for this model with these settings: lower the context or the GPU layers.";
  if (/(invalid|unknown|unsupported) model architecture|unknown model architecture/i.test(text))
    return "This engine does not know the model's architecture: update llama.cpp.";
  if (/failed to (open|read|load).*(model|gguf)|gguf_init_from_file/i.test(text))
    return "The model file could not be read.";
  const last = log.findLast((l) => /error|failed/i.test(l));
  return last
    ? last.replace(/^.*?(error|failed)/i, "$1").slice(0, 200)
    : `llama-server ended${code === undefined ? "" : ` (${code})`}.`;
}

/**
 * @param {{
 *   procs: import("./proc.js").Procs,
 *   sockets: import("./http.js").Sockets,
 *   program: () => string,
 *   onChange: (instances: Instance[]) => void,
 *   readyTimeoutMs?: number,
 * }} deps
 */
export function createEngine({ procs, sockets, program, onChange, readyTimeoutMs = 180_000 }) {
  /** @type {Map<string, Instance>} */
  const instances = new Map();
  const changed = () => onChange([...instances.values()]);

  /** A port nothing answers on, from FIRST_PORT up. */
  async function freePort() {
    const taken = new Set([...instances.values()].map((i) => i.port));
    for (let port = FIRST_PORT; port < FIRST_PORT + 64; port++) {
      if (taken.has(port)) continue;
      const busy = await sockets
        .connect({ host: "127.0.0.1", port, timeoutMs: 600 })
        .then((s) => {
          s.close();
          return true;
        })
        .catch(() => false);
      if (!busy) return port;
    }
    throw new Error("No free port from 39281 to 39344");
  }

  /** Poll /health until the model answers, the process ends, or time runs out. @param {Instance} inst */
  async function untilReady(inst) {
    const until = Date.now() + readyTimeoutMs;
    while (Date.now() < until) {
      if (inst.state !== "starting") return;
      const ok = await fetchJson(sockets, `http://127.0.0.1:${inst.port}/health`, {
        timeoutMs: 1000,
      })
        .then((h) => h?.status === "ok" || h?.status === undefined)
        .catch(() => false);
      if (ok && inst.state === "starting") {
        inst.state = "ready";
        inst.progress = 1;
        changed();
        return;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    if (inst.state === "starting") {
      inst.state = "failed";
      inst.error = "The model did not finish loading in time.";
      await inst.kill();
      changed();
    }
  }

  /**
   * Load a model file; resolves once it answers, or rejects with why it did not.
   * @param {{ path: string, alias: string, config: LoadConfig, projector?: string }} o
   * @returns {Promise<Instance>}
   */
  async function load(o) {
    const port = await freePort();
    const id = `127.0.0.1:${port}`;
    /** @type {Instance} */
    const inst = {
      id,
      path: o.path,
      alias: o.alias,
      port,
      config: o.config,
      state: "starting",
      startedAt: Date.now(),
      progress: 0.05,
      log: [],
      kill: async () => {},
    };
    instances.set(id, inst);
    changed();
    let ticks = 0;
    try {
      // No shell expands "~": a file under the home folder is named from there, the home folder the cwd.
      const home = (/** @type {string | undefined} */ p) => (p?.startsWith("~/") ? p.slice(2) : p);
      const handle = await procs.start(
        program(),
        serverArgs(home(o.path) ?? o.path, o.alias, port, o.config, home(o.projector)),
        {
          ...(o.path.startsWith("~/") ? { cwd: "~" } : {}),
          onLine: (_stream, text) => {
            inst.log.push(text);
            if (inst.log.length > LOG_LINES) inst.log.splice(0, inst.log.length - LOG_LINES);
            const next = progressOf(text, inst.progress ?? 0);
            if (next !== inst.progress || ++ticks % 20 === 0) {
              inst.progress = next;
              changed();
            }
          },
          onExit: (code) => {
            if (inst.state === "stopped") return;
            inst.error =
              inst.state === "ready"
                ? `The engine stopped${code ? ` (${code})` : ""}.`
                : failureOf(inst.log, code);
            inst.state = "failed";
            changed();
          },
        },
      );
      inst.kill = handle.kill;
    } catch (error) {
      inst.state = "failed";
      const code = /** @type {{ code?: string }} */ (error)?.code;
      inst.error =
        code === "not_found"
          ? "llama-server is not installed: install llama.cpp (for example `brew install llama.cpp`), or set where it is in Settings."
          : `Could not start llama-server: ${error instanceof Error ? error.message : error}`;
      changed();
      throw new Error(inst.error);
    }
    await untilReady(inst);
    if (inst.state !== "ready") throw new Error(inst.error ?? "The model did not load.");
    return inst;
  }

  /** End a loaded model's process. @param {string} id */
  async function eject(id) {
    const inst = instances.get(id);
    if (!inst) return;
    inst.state = "stopped";
    instances.delete(id);
    await inst.kill();
    changed();
  }

  return {
    load,
    eject,
    /** Forget a failed load. @param {string} id */
    dismiss(id) {
      if (instances.get(id)?.state === "failed") instances.delete(id);
      changed();
    },
    list: () => [...instances.values()],
    /** @param {string} id */
    get: (id) => instances.get(id),
  };
}

/** @typedef {ReturnType<typeof createEngine>} Engine */
