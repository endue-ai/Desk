// The OpenAI-compatible API most local servers speak (llama.cpp's server and many others): the
// models (/v1/models) and chat (/v1/chat/completions) streamed as server-sent events, with the
// usage, and llama.cpp's timings when the server sends them, in the last events.
import { errorText, fetchJson, HttpError, request } from "./http.js";
import { capsFromName, paramsOf, prettyName, quantOf } from "./models.js";
import { sse } from "./streams.js";

/**
 * @typedef {import("./http.js").Sockets} Sockets
 * @typedef {import("./models.js").Model} Model
 * @typedef {{ id: string, baseUrl: string, apiKey?: string }} ServerRef
 * @typedef {import("./chat-types.js").ChatRequest} ChatRequest
 * @typedef {import("./chat-types.js").ChatResult} ChatResult
 * @typedef {import("./chat-types.js").Delta} Delta
 */

/** @param {ServerRef} server */
const auth = (server) => (server.apiKey ? { authorization: `Bearer ${server.apiKey}` } : {});

/**
 * Whether an OpenAI-compatible server answers at the base URL, and which: llama.cpp's server
 * answers /props as well.
 * @param {Sockets} sockets @param {ServerRef} server
 */
export async function probe(sockets, server) {
  try {
    const models = await fetchJson(sockets, `${server.baseUrl}/v1/models`, {
      headers: auth(server),
      timeoutMs: 1500,
    });
    if (!Array.isArray(models?.data)) return undefined;
    const props = await fetchJson(sockets, `${server.baseUrl}/props`, {
      headers: auth(server),
      timeoutMs: 1500,
    }).catch(() => undefined);
    const llamaCpp = Boolean(props?.default_generation_settings || props?.build_info);
    return {
      flavor: llamaCpp ? "llama.cpp" : "openai",
      version: typeof props?.build_info === "string" ? props.build_info : undefined,
      ctx: props?.default_generation_settings?.n_ctx,
    };
  } catch {
    return undefined;
  }
}

/** @param {Sockets} sockets @param {ServerRef} server @returns {Promise<Model[]>} */
export async function listModels(sockets, server) {
  const answer = await fetchJson(sockets, `${server.baseUrl}/v1/models`, { headers: auth(server) });
  return (answer?.data ?? []).map((/** @type {any} */ m) => {
    const id = String(m.id);
    const meta = m.meta ?? {};
    return {
      id,
      name: prettyName(id),
      serverId: server.id,
      params: paramsOf(id) ?? (meta.n_params ? formatCount(meta.n_params) : undefined),
      quant: quantOf(id),
      size: meta.size,
      ctx: meta.n_ctx_train,
      caps: capsFromName(id),
      loaded: m.status?.value ? m.status.value === "loaded" : true,
      family: m.owned_by && m.owned_by !== "organization_owner" ? m.owned_by : undefined,
    };
  });
}

/** 7_241_732_096 → "7.2B". @param {number} n */
function formatCount(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `${Math.round(n / 1e6)}M`;
  return String(n);
}

/** A message in OpenAI's shape, images as data URLs. @param {import("./chat-types.js").ChatMessage} m */
export function messageOf(m) {
  /** @type {Record<string, unknown>} */
  const out = { role: m.role };
  if (m.images?.length) {
    out.content = [
      ...(m.content ? [{ type: "text", text: m.content }] : []),
      ...m.images.map((i) => ({
        type: "image_url",
        image_url: { url: `data:${i.type};base64,${i.data}` },
      })),
    ];
  } else out.content = m.content;
  if (m.toolCalls?.length)
    out.tool_calls = m.toolCalls.map((c) => ({
      id: c.id,
      type: "function",
      function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
    }));
  if (m.toolCallId) out.tool_call_id = m.toolCallId;
  return out;
}

/** The sampling settings as the request's fields. @param {ChatRequest["params"]} p */
export function samplingOf(p = {}) {
  /** @type {Record<string, unknown>} */
  const out = {};
  const put = (/** @type {string} */ key, /** @type {unknown} */ value) => {
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  };
  put("temperature", p.temperature);
  put("top_p", p.topP);
  put("top_k", p.topK);
  put("min_p", p.minP);
  put("repeat_penalty", p.repeatPenalty);
  put("presence_penalty", p.presencePenalty);
  put("frequency_penalty", p.frequencyPenalty);
  put("max_tokens", p.maxTokens);
  put("seed", p.seed);
  if (p.stop?.length) out.stop = p.stop;
  return out;
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
    stream_options: { include_usage: true },
    messages: req.messages.map(messageOf),
    ...samplingOf(req.params),
  };
  if (req.format)
    body.response_format =
      req.format === "json"
        ? { type: "json_object" }
        : {
            type: "json_schema",
            json_schema: { name: "answer", schema: req.format, strict: true },
          };
  if (req.tools?.length) body.tools = req.tools;
  const response = await request(sockets, `${server.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      ...auth(server),
    },
    body: JSON.stringify(body),
    signal: req.signal,
    timeoutMs: 10000,
  });
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
  let usage;
  /** @type {any} */
  let timings;
  /** @type {string | undefined} */
  let finish;
  /** @type {Map<number, { id: string, name: string, args: string }>} */
  const calls = new Map();
  for await (const event of sse(response.body)) {
    if (event.data === "[DONE]") break;
    /** @type {any} */
    let chunk;
    try {
      chunk = JSON.parse(event.data);
    } catch {
      continue;
    }
    if (chunk.error) throw new HttpError(errorText(0, JSON.stringify(chunk)), { code: "refused" });
    if (chunk.usage) usage = chunk.usage;
    if (chunk.timings) timings = chunk.timings;
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta ?? {};
    const think = delta.reasoning_content ?? delta.reasoning;
    if (think) {
      first ??= Date.now();
      reasoning += think;
      onDelta({ reasoning: think });
    }
    if (delta.content) {
      first ??= Date.now();
      content += delta.content;
      pieces++;
      onDelta({ content: delta.content });
    }
    for (const call of delta.tool_calls ?? []) {
      first ??= Date.now();
      const index = call.index ?? calls.size;
      const entry = calls.get(index) ?? { id: call.id ?? `call_${index + 1}`, name: "", args: "" };
      if (call.function?.name) entry.name += call.function.name;
      if (call.function?.arguments) entry.args += call.function.arguments;
      calls.set(index, entry);
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  const toolCalls = [...calls.values()].map((c) => {
    /** @type {Record<string, unknown>} */
    let args = {};
    try {
      args = c.args ? JSON.parse(c.args) : {};
    } catch {
      args = { _raw: c.args };
    }
    const call = { id: c.id, name: c.name, args };
    onDelta({ toolCall: call });
    return call;
  });
  const ended = Date.now();
  const tokens = timings?.predicted_n ?? usage?.completion_tokens ?? pieces;
  return {
    content,
    reasoning,
    toolCalls,
    stats: {
      promptTokens: timings?.prompt_n ?? usage?.prompt_tokens,
      tokens,
      ttftMs: first === undefined ? undefined : first - started,
      totalMs: ended - started,
      tokPerSec:
        timings?.predicted_per_second ??
        (first !== undefined && ended > first ? (tokens / (ended - first)) * 1000 : undefined),
      stopReason: req.signal?.aborted ? "stopped" : (finish ?? "stop"),
    },
  };
}

/** Vectors for texts, from an embedding model. @param {Sockets} sockets @param {ServerRef} server @param {string} model @param {string[]} input @returns {Promise<number[][]>} */
export async function embed(sockets, server, model, input) {
  const answer = await fetchJson(sockets, `${server.baseUrl}/v1/embeddings`, {
    json: { model, input },
    headers: auth(server),
    timeoutMs: 30000,
  });
  if (!Array.isArray(answer?.data)) throw new HttpError("The server answered no vectors");
  return [...answer.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding);
}
