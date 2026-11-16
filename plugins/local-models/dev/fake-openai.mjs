// The made-up OpenAI-compatible server, the way llama.cpp's server answers: /health, /props,
// /v1/models with the model's metadata, /v1/embeddings, and /v1/chat/completions streamed as
// server-sent events with the usage and timings at the end.
import { answerFor, tokens } from "./answers.mjs";
import { json, jsonAnswer, listen, readBody, sleep } from "./fake-common.mjs";
import { fakeEmbedding } from "./fake-embed.mjs";

export const OPENAI_MODEL = {
  id: "mistral-small-3.2-24b-instruct-2506-Q4_K_M.gguf",
  n_params: 23_572_403_200,
  size: 14_333_910_240,
  n_ctx_train: 131072,
};

/** @param {{ tokenMs: number, requests: { path: string, body: any }[], model?: typeof OPENAI_MODEL, ready?: () => boolean }} o */
export function openaiHandler(o) {
  const M = o.model ?? OPENAI_MODEL;
  return async (
    /** @type {import("node:http").IncomingMessage} */ req,
    /** @type {import("node:http").ServerResponse} */ res,
  ) => {
    const url = new URL(req.url ?? "/", "http://x");
    const body = req.method === "POST" ? await readBody(req) : {};
    o.requests.push({ path: url.pathname, body });
    if (url.pathname === "/health")
      return o.ready && !o.ready()
        ? json(res, 503, {
            error: { code: 503, message: "Loading model", type: "unavailable_error" },
          })
        : json(res, 200, { status: "ok" });
    if (url.pathname === "/props")
      return json(res, 200, {
        default_generation_settings: { n_ctx: 16384, params: { temperature: 0.15 } },
        total_slots: 1,
        model_path: `/models/${M.id}`,
        build_info: "b6904-3f1a2c8",
      });
    if (url.pathname === "/v1/models")
      return json(res, 200, {
        object: "list",
        data: [
          {
            id: M.id,
            object: "model",
            created: 1762000000,
            owned_by: "llamacpp",
            meta: {
              n_params: M.n_params,
              size: M.size,
              n_ctx_train: M.n_ctx_train,
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
      if (body.model && body.model !== M.id)
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
          model: M.id,
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
        model: M.id,
        choices: [{ index: 0, delta: {}, finish_reason: finish }],
      });
      send({
        id,
        object: "chat.completion.chunk",
        created: 0,
        model: M.id,
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

/**
 * One OpenAI-compatible server for one model, the way llama-server serves a file: /health answers 503
 * until `ready()` says it loaded.
 * @param {number} port @param {{ tokenMs?: number, model: typeof OPENAI_MODEL, ready?: () => boolean }} o
 */
export async function startOpenAiServer(port, o) {
  /** @type {{ path: string, body: any }[]} */
  const requests = [];
  const server = /** @type {import("node:http").Server} */ (
    await listen(
      port,
      openaiHandler({ tokenMs: o.tokenMs ?? 14, requests, model: o.model, ready: o.ready }),
    )
  );
  return {
    requests,
    port: /** @type {import("node:net").AddressInfo} */ (server.address()).port,
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
