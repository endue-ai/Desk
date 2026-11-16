// Made-up model servers for the preview and the tests: one speaking Ollama's API, one speaking the
// OpenAI-compatible API the way llama.cpp's server does (with /props and timings). Both stream the
// answers in dev/answers.mjs at a steady speed and count tokens like a real server.
//
//   import { startFakeLlm } from "./fake-llm.mjs";
//   const fake = await startFakeLlm({ ollamaPort: 0, openaiPort: 0, tokenMs: 12 });
//   fake.ollamaPort, fake.openaiPort, await fake.close()
import { createServer } from "node:http";
import { answerFor, tokens } from "./answers.mjs";

/** @typedef {{ name: string, family: string, params: string, quant: string, size: number, caps: string[], ctx: number, loaded?: boolean }} FakeModel */

/** @type {FakeModel[]} */
export const OLLAMA_MODELS = [
  {
    name: "qwen3:8b",
    family: "qwen3",
    params: "8.2B",
    quant: "Q4_K_M",
    size: 5_225_376_047,
    caps: ["completion", "tools", "thinking"],
    ctx: 40960,
    loaded: true,
  },
  {
    name: "gemma3:12b",
    family: "gemma3",
    params: "12.2B",
    quant: "Q4_K_M",
    size: 8_149_190_253,
    caps: ["completion", "vision"],
    ctx: 131072,
  },
  {
    name: "llama3.2:3b",
    family: "llama",
    params: "3.2B",
    quant: "Q4_K_M",
    size: 2_019_393_189,
    caps: ["completion", "tools"],
    ctx: 131072,
  },
  {
    name: "qwen2.5-coder:7b",
    family: "qwen2",
    params: "7.6B",
    quant: "Q4_K_M",
    size: 4_683_087_332,
    caps: ["completion", "tools", "insert"],
    ctx: 32768,
  },
  {
    name: "deepseek-r1:14b",
    family: "qwen2",
    params: "14.8B",
    quant: "Q4_K_M",
    size: 8_988_112_040,
    caps: ["completion", "thinking"],
    ctx: 131072,
  },
  {
    name: "nomic-embed-text:latest",
    family: "nomic-bert",
    params: "137M",
    quant: "F16",
    size: 274_302_450,
    caps: ["embedding"],
    ctx: 2048,
  },
];

export const OPENAI_MODEL = {
  id: "mistral-small-3.2-24b-instruct-2506-Q4_K_M.gguf",
  n_params: 23_572_403_200,
  size: 14_333_910_240,
  n_ctx_train: 131072,
};

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** What a model held to JSON answers. @param {{ role: string, content: unknown }[]} messages */
function jsonAnswer(messages) {
  const asked = String(messages.findLast((m) => m.role === "user")?.content ?? "");
  return JSON.stringify({
    answer: `A structured answer to: ${asked.slice(0, 60)}`,
    confidence: 0.82,
    tags: ["local", "structured"],
  });
}

/** @param {import("node:http").IncomingMessage} req */
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/** @param {import("node:http").ServerResponse} res @param {number} status @param {unknown} body */
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Whether a model thinks before answering. @param {string} id */
const thinks = (id) => /qwen3|deepseek-r1|qwq/.test(id);

/** A deterministic embedding: a bag of character trigrams folded into 64 numbers. @param {string} text */
export function fakeEmbedding(text) {
  const v = new Array(64).fill(0);
  const t = ` ${text.toLowerCase()} `;
  for (let i = 0; i + 3 <= t.length; i++) {
    let hash = 0;
    for (const ch of t.slice(i, i + 3)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    v[hash % 64] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

/** @param {{ tokenMs: number, requests: { path: string, body: any }[] }} o */
function ollamaHandler(o) {
  /** @type {Set<string>} */
  const loaded = new Set(OLLAMA_MODELS.filter((m) => m.loaded).map((m) => m.name));
  return async (
    /** @type {import("node:http").IncomingMessage} */ req,
    /** @type {import("node:http").ServerResponse} */ res,
  ) => {
    const url = new URL(req.url ?? "/", "http://x");
    const body = req.method === "POST" ? await readBody(req) : {};
    o.requests.push({ path: url.pathname, body });
    if (url.pathname === "/api/version") return json(res, 200, { version: "0.12.6" });
    if (url.pathname === "/api/tags")
      return json(res, 200, {
        models: OLLAMA_MODELS.map((m) => ({
          name: m.name,
          model: m.name,
          modified_at: "2026-11-10T09:12:44.000Z",
          size: m.size,
          digest: "0".repeat(64),
          details: {
            format: "gguf",
            family: m.family,
            parameter_size: m.params,
            quantization_level: m.quant,
          },
          capabilities: m.caps,
        })),
      });
    if (url.pathname === "/api/ps")
      return json(res, 200, {
        models: OLLAMA_MODELS.filter((m) => loaded.has(m.name)).map((m) => ({
          name: m.name,
          model: m.name,
          size: m.size + 600_000_000,
          size_vram: m.size + 600_000_000,
          expires_at: "2026-11-17T12:00:00Z",
          context_length: 8192,
        })),
      });
    if (url.pathname === "/api/show") {
      const m = OLLAMA_MODELS.find((x) => x.name === body.model || x.name === body.name);
      if (!m) return json(res, 404, { error: `model '${body.model}' not found` });
      return json(res, 200, {
        capabilities: m.caps,
        model_info: {
          "general.architecture": m.family,
          [`${m.family}.context_length`]: m.ctx,
          "general.parameter_count": 8_190_735_360,
        },
        template: "{{ .System }}{{ .Prompt }}",
        parameters: "temperature 0.6\ntop_p 0.95",
        license: "Apache License 2.0",
      });
    }
    if (url.pathname === "/api/generate") {
      if (body.keep_alive === 0) loaded.delete(body.model);
      else loaded.add(body.model);
      return json(res, 200, {
        model: body.model,
        done: true,
        done_reason: body.keep_alive === 0 ? "unload" : "load",
        response: "",
      });
    }
    if (url.pathname === "/api/embed") {
      const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ""];
      return json(res, 200, {
        model: body.model,
        embeddings: inputs.map((t) => fakeEmbedding(String(t))),
      });
    }
    if (url.pathname === "/api/chat") {
      const m = OLLAMA_MODELS.find((x) => x.name === body.model);
      if (!m)
        return json(res, 404, { error: `model "${body.model}" not found, try pulling it first` });
      if (m.caps.includes("embedding"))
        return json(res, 400, { error: `"${body.model}" does not support chat` });
      loaded.add(m.name);
      const said = answerFor(body.messages ?? []);
      const thought = said.thought;
      const answer = body.format ? jsonAnswer(body.messages ?? []) : said.answer;
      res.writeHead(200, {
        "content-type": "application/x-ndjson",
        "transfer-encoding": "chunked",
      });
      const write = (/** @type {object} */ x) => res.write(`${JSON.stringify(x)}\n`);
      let closed = false;
      req.on("close", () => {
        closed = true;
      });
      res.on("close", () => {
        closed = true;
      });
      const think = thinks(m.name) && body.think !== false;
      const asField = body.think === true;
      const pieces = [
        ...(think && asField ? tokens(thought).map((t) => ({ thinking: t })) : []),
        ...(think && !asField
          ? [
              { content: "<think>\n" },
              ...tokens(thought).map((t) => ({ content: t })),
              { content: "\n</think>\n\n" },
            ]
          : []),
        ...tokens(answer).map((t) => ({ content: t })),
      ];
      const limit =
        body.options?.num_predict > 0 ? body.options.num_predict : Number.POSITIVE_INFINITY;
      let count = 0;
      for (const piece of pieces) {
        if (closed) return;
        if (count >= limit) break;
        await sleep(o.tokenMs);
        write({
          model: m.name,
          created_at: new Date().toISOString(),
          message: { role: "assistant", content: "", ...piece },
          done: false,
        });
        count++;
      }
      if (closed) return;
      write({
        model: m.name,
        created_at: new Date().toISOString(),
        message: { role: "assistant", content: "" },
        done: true,
        done_reason: count >= limit ? "length" : "stop",
        total_duration: (count * o.tokenMs + 180) * 1e6,
        load_duration: 42e6,
        prompt_eval_count: 24 + Math.round(JSON.stringify(body.messages ?? []).length / 4),
        prompt_eval_duration: 95e6,
        eval_count: count,
        eval_duration: count * o.tokenMs * 1e6,
      });
      res.end();
      return;
    }
    json(res, 404, { error: "not found" });
  };
}

/** @param {{ tokenMs: number, requests: { path: string, body: any }[] }} o */
function openaiHandler(o) {
  return async (
    /** @type {import("node:http").IncomingMessage} */ req,
    /** @type {import("node:http").ServerResponse} */ res,
  ) => {
    const url = new URL(req.url ?? "/", "http://x");
    const body = req.method === "POST" ? await readBody(req) : {};
    o.requests.push({ path: url.pathname, body });
    if (url.pathname === "/health") return json(res, 200, { status: "ok" });
    if (url.pathname === "/props")
      return json(res, 200, {
        default_generation_settings: { n_ctx: 16384, params: { temperature: 0.15 } },
        total_slots: 1,
        model_path: `/models/${OPENAI_MODEL.id}`,
        build_info: "b6904-3f1a2c8",
      });
    if (url.pathname === "/v1/models")
      return json(res, 200, {
        object: "list",
        data: [
          {
            id: OPENAI_MODEL.id,
            object: "model",
            created: 1762000000,
            owned_by: "llamacpp",
            meta: {
              n_params: OPENAI_MODEL.n_params,
              size: OPENAI_MODEL.size,
              n_ctx_train: OPENAI_MODEL.n_ctx_train,
            },
          },
        ],
      });
    if (url.pathname === "/v1/embeddings") {
      const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ""];
      return json(res, 200, {
        object: "list",
        data: inputs.map((t, i) => ({
          object: "embedding",
          index: i,
          embedding: fakeEmbedding(String(t)),
        })),
        model: body.model,
      });
    }
    if (url.pathname === "/v1/chat/completions") {
      if (body.model && body.model !== OPENAI_MODEL.id)
        return json(res, 404, {
          error: { message: `model ${body.model} not loaded`, type: "not_found_error" },
        });
      const answer = body.response_format
        ? jsonAnswer(body.messages ?? [])
        : answerFor(body.messages ?? []).answer;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "transfer-encoding": "chunked",
      });
      let closed = false;
      res.on("close", () => {
        closed = true;
      });
      const id = `chatcmpl-${Date.now().toString(36)}`;
      const send = (/** @type {object} */ x) => res.write(`data: ${JSON.stringify(x)}\n\n`);
      const parts = tokens(answer);
      const limit = body.max_tokens > 0 ? body.max_tokens : Number.POSITIVE_INFINITY;
      let count = 0;
      for (const t of parts) {
        if (closed) return;
        if (count >= limit) break;
        await sleep(o.tokenMs * 1.6);
        send({
          id,
          object: "chat.completion.chunk",
          created: 0,
          model: OPENAI_MODEL.id,
          choices: [{ index: 0, delta: { content: t }, finish_reason: null }],
        });
        count++;
      }
      if (closed) return;
      const finish = count >= limit ? "length" : "stop";
      send({
        id,
        object: "chat.completion.chunk",
        created: 0,
        model: OPENAI_MODEL.id,
        choices: [{ index: 0, delta: {}, finish_reason: finish }],
      });
      send({
        id,
        object: "chat.completion.chunk",
        created: 0,
        model: OPENAI_MODEL.id,
        choices: [],
        usage: { prompt_tokens: 31, completion_tokens: count, total_tokens: 31 + count },
        timings: {
          prompt_n: 31,
          prompt_ms: 88.2,
          predicted_n: count,
          predicted_ms: count * o.tokenMs * 1.6,
          predicted_per_second: 1000 / (o.tokenMs * 1.6),
        },
      });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    json(res, 404, { error: { message: "not found" } });
  };
}

/** @param {number} port @param {(req: any, res: any) => void} handler */
function listen(port, handler) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => void handler(req, res));
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

/** @param {{ ollamaPort?: number, openaiPort?: number, tokenMs?: number }} [options] */
export async function startFakeLlm(options = {}) {
  const tokenMs = options.tokenMs ?? 14;
  /** @type {{ path: string, body: any }[]} */
  const requests = [];
  const ollama = /** @type {import("node:http").Server} */ (
    await listen(options.ollamaPort ?? 0, ollamaHandler({ tokenMs, requests }))
  );
  const openai = /** @type {import("node:http").Server} */ (
    await listen(options.openaiPort ?? 0, openaiHandler({ tokenMs, requests }))
  );
  const portOf = (/** @type {import("node:http").Server} */ s) =>
    /** @type {import("node:net").AddressInfo} */ (s.address()).port;
  return {
    requests,
    ollamaPort: portOf(ollama),
    openaiPort: portOf(openai),
    async close() {
      ollama.closeAllConnections();
      openai.closeAllConnections();
      await Promise.all([new Promise((r) => ollama.close(r)), new Promise((r) => openai.close(r))]);
    },
  };
}
