// Ollama's own API: the models pulled (/api/tags), the ones in memory (/api/ps), a model's details
// (/api/show), and chat (/api/chat), streamed as one JSON object per line, its last carrying the
// counts and durations the stats come from.
import { errorText, fetchJson, HttpError, request } from "./http.js";
import { capsFromName, paramsOf, prettyName, quantOf } from "./models.js";
import { ndjson } from "./streams.js";

/**
 * @typedef {import("./http.js").Sockets} Sockets
 * @typedef {import("./models.js").Model} Model
 * @typedef {import("./models.js").Capability} Capability
 * @typedef {{ id: string, baseUrl: string, apiKey?: string }} ServerRef
 * @typedef {import("./chat-types.js").ChatRequest} ChatRequest
 * @typedef {import("./chat-types.js").ChatResult} ChatResult
 * @typedef {import("./chat-types.js").Delta} Delta
 */

/** @param {ServerRef} server */
const auth = (server) => (server.apiKey ? { authorization: `Bearer ${server.apiKey}` } : {});

/** Whether Ollama answers at the base URL: its version, or undefined. @param {Sockets} sockets @param {ServerRef} server */
export async function probe(sockets, server) {
  try {
    const answer = await fetchJson(sockets, `${server.baseUrl}/api/version`, {
      headers: auth(server),
      timeoutMs: 1500,
    });
    return typeof answer?.version === "string" ? { version: answer.version } : undefined;
  } catch {
    return undefined;
  }
}

/** Ollama's capability words, in this window's. @param {string[] | undefined} words @param {string} id */
function capsOf(words, id) {
  if (!Array.isArray(words)) return capsFromName(id);
  /** @type {Capability[]} */
  const caps = [];
  if (words.includes("vision")) caps.push("vision");
  if (words.includes("tools")) caps.push("tools");
  if (words.includes("thinking")) caps.push("reasoning");
  if (words.includes("embedding")) caps.push("embedding");
  if (capsFromName(id).includes("code")) caps.push("code");
  return caps;
}

/** Every model pulled, those in memory marked. @param {Sockets} sockets @param {ServerRef} server @returns {Promise<Model[]>} */
export async function listModels(sockets, server) {
  const [tags, ps] = await Promise.all([
    fetchJson(sockets, `${server.baseUrl}/api/tags`, { headers: auth(server) }),
    fetchJson(sockets, `${server.baseUrl}/api/ps`, { headers: auth(server) }).catch(() => ({
      models: [],
    })),
  ]);
  /** @type {Map<string, any>} */
  const running = new Map((ps?.models ?? []).map((/** @type {any} */ m) => [m.name ?? m.model, m]));
  return (tags?.models ?? []).map((/** @type {any} */ m) => {
    const id = String(m.name ?? m.model);
    const live = running.get(id);
    return {
      id,
      name: prettyName(id),
      serverId: server.id,
      family: m.details?.family,
      params: m.details?.parameter_size || paramsOf(id),
      quant: m.details?.quantization_level || quantOf(id),
      size: m.size,
      format: m.details?.format,
      modified: m.modified_at,
      caps: capsOf(m.capabilities, id),
      loaded: Boolean(live),
      vram: live?.size_vram,
      loadedCtx: live?.context_length,
    };
  });
}

/** A model's details: capabilities, context length, template, license. @param {Sockets} sockets @param {ServerRef} server @param {string} id */
export async function showModel(sockets, server, id) {
  const info = await fetchJson(sockets, `${server.baseUrl}/api/show`, {
    json: { model: id },
    headers: auth(server),
  });
  const meta = info?.model_info ?? {};
  const arch = meta["general.architecture"];
  return {
    caps: capsOf(info?.capabilities, id),
    ctx: arch ? meta[`${arch}.context_length`] : undefined,
    arch,
    paramCount: meta["general.parameter_count"],
    template: info?.template,
    license: info?.license,
    parameters: info?.parameters,
    system: info?.system,
  };
}

/** The sampling settings as Ollama's options. @param {ChatRequest["params"]} p */
export function optionsOf(p = {}) {
  /** @type {Record<string, unknown>} */
  const options = {};
  const put = (/** @type {string} */ key, /** @type {unknown} */ value) => {
    if (value !== undefined && value !== null && value !== "") options[key] = value;
  };
  put("temperature", p.temperature);
  put("top_p", p.topP);
  put("top_k", p.topK);
  put("min_p", p.minP);
  put("repeat_penalty", p.repeatPenalty);
  put("presence_penalty", p.presencePenalty);
  put("frequency_penalty", p.frequencyPenalty);
  put("num_predict", p.maxTokens);
  put("num_ctx", p.contextLength);
  put("seed", p.seed);
  if (p.stop?.length) options.stop = p.stop;
  return options;
}

/**
 * Chat, streaming each piece to `onDelta`; resolves with the whole answer and its stats.
 * @param {Sockets} sockets @param {ServerRef} server @param {ChatRequest} req @param {(d: Delta) => void} onDelta
 * @returns {Promise<ChatResult>}
 */
export async function chat(sockets, server, req, onDelta) {
  const started = Date.now();
  /** @type {Record<string, unknown>} */
  const body = {
    model: req.model,
    stream: true,
    messages: req.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.images?.length ? { images: m.images.map((i) => i.data) } : {}),
      ...(m.toolCalls?.length
        ? {
            tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args } })),
          }
        : {}),
    })),
    options: optionsOf(req.params),
  };
  if (req.think !== undefined) body.think = req.think;
  if (req.format) body.format = req.format;
  if (req.tools?.length) body.tools = req.tools;
  if (req.keepAlive) body.keep_alive = req.keepAlive;
  const post = () =>
    request(sockets, `${server.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth(server) },
      body: JSON.stringify(body),
      signal: req.signal,
      timeoutMs: 10000,
    });
  let response = await post();
  if (response.status === 400 && body.think !== undefined) {
    // A model that does not think refuses the field: ask again without it.
    const text = await response.text().catch(() => "");
    if (!/think/i.test(text))
      throw new HttpError(errorText(response.status, text), {
        status: response.status,
        body: text,
      });
    delete body.think;
    response = await post();
  }
  if (response.status >= 400) {
    const text = await response.text().catch(() => "");
    throw new HttpError(errorText(response.status, text), { status: response.status, body: text });
  }
  let content = "";
  let reasoning = "";
  /** @type {number | undefined} */
  let first;
  let pieces = 0;
  /** @type {any} */
  let last = {};
  /** @type {import("./chat-types.js").ToolCall[]} */
  const toolCalls = [];
  for await (const chunk of ndjson(response.body)) {
    if (chunk.error) throw new HttpError(String(chunk.error), { code: "refused" });
    const m = chunk.message ?? {};
    if (m.thinking) {
      first ??= Date.now();
      reasoning += m.thinking;
      onDelta({ reasoning: m.thinking });
    }
    if (m.content) {
      first ??= Date.now();
      content += m.content;
      pieces++;
      onDelta({ content: m.content });
    }
    for (const call of m.tool_calls ?? []) {
      first ??= Date.now();
      const c = {
        id: `call_${toolCalls.length + 1}`,
        name: call.function?.name,
        args: call.function?.arguments ?? {},
      };
      toolCalls.push(c);
      onDelta({ toolCall: c });
    }
    if (chunk.done) last = chunk;
  }
  const ended = Date.now();
  const evalSeconds = last.eval_duration ? last.eval_duration / 1e9 : undefined;
  const tokens = last.eval_count ?? pieces;
  return {
    content,
    reasoning,
    toolCalls,
    stats: {
      promptTokens: last.prompt_eval_count,
      tokens,
      ttftMs: first === undefined ? undefined : first - started,
      totalMs: ended - started,
      tokPerSec:
        evalSeconds && tokens
          ? tokens / evalSeconds
          : first !== undefined && ended > first
            ? (tokens / (ended - first)) * 1000
            : undefined,
      loadMs: last.load_duration ? last.load_duration / 1e6 : undefined,
      stopReason: req.signal?.aborted ? "stopped" : (last.done_reason ?? "stop"),
    },
  };
}

/** Load a model into memory now (an empty chat) so the first answer starts at once. @param {Sockets} sockets @param {ServerRef} server @param {string} id */
export async function load(sockets, server, id) {
  await fetchJson(sockets, `${server.baseUrl}/api/generate`, {
    json: { model: id, keep_alive: "10m" },
    headers: auth(server),
    timeoutMs: 10000,
  });
}

/** Take a model out of memory. @param {Sockets} sockets @param {ServerRef} server @param {string} id */
export async function unload(sockets, server, id) {
  await fetchJson(sockets, `${server.baseUrl}/api/generate`, {
    json: { model: id, keep_alive: 0 },
    headers: auth(server),
  });
}

/**
 * Pull a model into Ollama, telling its progress (bytes of all its layers) as it streams.
 * @param {Sockets} sockets @param {ServerRef} server @param {string} name
 * @param {(p: { total: number, completed: number, status: string }) => void} onProgress @param {AbortSignal} [signal]
 */
export async function pull(sockets, server, name, onProgress, signal) {
  const response = await request(sockets, `${server.baseUrl}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth(server) },
    body: JSON.stringify({ model: name, stream: true }),
    signal,
    timeoutMs: 10000,
  });
  if (response.status >= 400) {
    const text = await response.text().catch(() => "");
    throw new HttpError(errorText(response.status, text), { status: response.status, body: text });
  }
  /** @type {Map<string, { total: number, completed: number }>} */
  const layers = new Map();
  for await (const p of ndjson(response.body)) {
    if (p.error) throw new HttpError(String(p.error), { code: "refused" });
    if (p.digest && p.total) layers.set(p.digest, { total: p.total, completed: p.completed ?? 0 });
    let total = 0;
    let completed = 0;
    for (const l of layers.values()) {
      total += l.total;
      completed += l.completed;
    }
    onProgress({ total, completed, status: String(p.status ?? "") });
    if (p.status === "success") return;
  }
  throw new HttpError("Ollama stopped before the pull finished");
}

/** Remove a model from Ollama. @param {Sockets} sockets @param {ServerRef} server @param {string} name */
export async function remove(sockets, server, name) {
  const response = await request(sockets, `${server.baseUrl}/api/delete`, {
    method: "DELETE",
    headers: { "content-type": "application/json", ...auth(server) },
    body: JSON.stringify({ model: name }),
  });
  if (response.status >= 400)
    throw new HttpError(errorText(response.status, await response.text()), {
      status: response.status,
    });
  await response.text();
}

/** Vectors for texts, from an embedding model. @param {Sockets} sockets @param {ServerRef} server @param {string} model @param {string[]} input @returns {Promise<number[][]>} */
export async function embed(sockets, server, model, input) {
  const answer = await fetchJson(sockets, `${server.baseUrl}/api/embed`, {
    json: { model, input },
    headers: auth(server),
    timeoutMs: 30000,
  });
  if (!Array.isArray(answer?.embeddings)) throw new HttpError("Ollama answered no vectors");
  return answer.embeddings;
}
