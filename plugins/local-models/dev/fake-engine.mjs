// A made-up llama-server for the preview and the tests: it reads the arguments the real one takes
// (-m, --alias, --port, -c, -ngl), writes the kind of log the real one writes while it loads, and then
// serves the model as an OpenAI-compatible server on that port until it is killed.
import { closeSync, openSync, readSync } from "node:fs";
import { startOpenAiServer } from "./fake-llm.mjs";

/** @param {string[]} args @param {string} flag */
const argOf = (args, flag) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
};

/**
 * Start one; `onLine` hears its log, `onExit` its end.
 * @param {string[]} args
 * @param {{ onLine: (stream: "stdout" | "stderr", text: string) => void, onExit: (code: number | null) => void, loadMs?: number, tokenMs?: number }} o
 */
export async function startFakeEngine(args, o) {
  const path = argOf(args, "-m") ?? "";
  const alias =
    argOf(args, "--alias") ??
    path
      .split("/")
      .pop()
      ?.replace(/\.gguf$/i, "") ??
    "model";
  const port = Number(argOf(args, "--port") ?? 8080);
  const ctx = Number(argOf(args, "-c") ?? 4096);
  const ngl = argOf(args, "-ngl") ?? "999";
  const head = Buffer.alloc(4);
  try {
    const fd = openSync(path, "r");
    readSync(fd, head, 0, 4, 0);
    closeSync(fd);
  } catch {}
  const timers = /** @type {ReturnType<typeof setTimeout>[]} */ ([]);
  const say = (/** @type {string} */ text, /** @type {number} */ at) =>
    timers.push(setTimeout(() => o.onLine("stderr", text), at));
  if (head.toString("ascii") !== "GGUF") {
    say(`gguf_init_from_file: failed to open GGUF file '${path}'`, 50);
    say("llama_model_load: error loading model: failed to load model", 80);
    timers.push(setTimeout(() => o.onExit(1), 120));
    return { kill() {} };
  }
  let ready = false;
  const load = o.loadMs ?? 1200;
  const server = await startOpenAiServer(port, {
    tokenMs: o.tokenMs ?? 14,
    model: { id: alias, n_params: 4_022_468_096, size: 2_497_280_256, n_ctx_train: 262144 },
    ready: () => ready,
  });
  say("build: 6904 (3f1a2c8) with Apple clang version 17.0.0 for arm64-apple-darwin25.2.0", 10);
  say("system info: n_threads = 4, n_threads_batch = 4, total_threads = 10", 40);
  say(`main: binding port with default address family`, 60);
  say(`main: HTTP server is listening, hostname: 127.0.0.1, port: ${port}, http threads: 9`, 80);
  say("main: loading model", 100);
  say(
    `llama_model_load_from_file_impl: using device Metal (Apple M4) - 18432 MiB free`,
    load * 0.2,
  );
  say(
    `llama_model_loader: loaded meta data with 34 key-value pairs and 398 tensors from ${path}`,
    load * 0.3,
  );
  say(`load_tensors: offloading ${ngl === "0" ? 0 : 36} repeating layers to GPU`, load * 0.5);
  say(`load_tensors: offloaded ${ngl === "0" ? 0 : 37}/37 layers to GPU`, load * 0.55);
  say("load_tensors:   CPU_Mapped model buffer size =   304.28 MiB", load * 0.6);
  say("load_tensors: Metal_Mapped model buffer size =  2381.64 MiB", load * 0.62);
  say(`llama_context: n_ctx         = ${ctx}`, load * 0.75);
  say(
    `llama_kv_cache:      Metal KV buffer size =   ${Math.round((ctx / 4096) * 576)}.00 MiB`,
    load * 0.8,
  );
  say("srv  load_model: initializing slots, n_slots = 1", load * 0.9);
  timers.push(
    setTimeout(() => {
      ready = true;
      o.onLine("stderr", `main: model loaded`);
      o.onLine(
        "stderr",
        `main: server is listening on http://127.0.0.1:${port} - starting the main loop`,
      );
      o.onLine("stderr", "srv  update_slots: all slots are idle");
    }, load),
  );
  let ended = false;
  return {
    port,
    kill() {
      if (ended) return;
      ended = true;
      for (const t of timers) clearTimeout(t);
      void server.close().then(() => o.onExit(null));
    },
  };
}
