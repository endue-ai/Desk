// Running an answer: the request built from the thread's path (its system prompt, the messages up to
// a node), the tokens streamed into the node being written with its live speed, the stats kept with
// it, reasoning taken out of the text, and a stop that keeps what came. complete() asks once with no
// window, for titles and commands.
import { clientOf } from "./servers.js";
import { splitThink } from "./think.js";
import { addNode, pathTo } from "./threads.js";

/**
 * @typedef {import("./threads.js").Thread} Thread
 * @typedef {import("./threads.js").Node} Node
 * @typedef {import("./chat-types.js").ChatMessage} ChatMessage
 * @typedef {import("./chat-types.js").Sampling} Sampling
 * @typedef {import("./servers.js").Server} Server
 * @typedef {import("./models.js").Model} Model
 * @typedef {{ server?: Server, model?: Model, id: string }} Target
 */

const message = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));

/** The messages a request sends: the system prompt, then the path up to a node. @param {Thread} thread @param {string} upTo */
export function messagesFor(thread, upTo) {
  /** @type {ChatMessage[]} */
  const out = [];
  if (thread.system?.trim()) out.push({ role: "system", content: thread.system.trim() });
  for (const node of pathTo(thread, upTo)) {
    if (node.error && !node.content) continue;
    const said = node.role === "assistant" ? splitThink(node.content).content : node.content;
    // What the question was sent with (a file, the passages found) goes before its words.
    const content = node.context ? `${node.context}\n\n${said}` : said;
    out.push({
      role: node.role,
      content,
      ...(node.images?.length ? { images: node.images } : {}),
      ...(node.toolCalls?.length ? { toolCalls: node.toolCalls } : {}),
      ...(node.toolCallId ? { toolCallId: node.toolCallId } : {}),
    });
  }
  return out;
}

/** Whether to ask Ollama for its reasoning in a field of its own. @param {Target} t @param {Thread} thread */
const thinkOf = (t, thread) =>
  t.server?.kind === "ollama" && t.model?.caps.includes("reasoning")
    ? thread.think !== false
    : undefined;

/**
 * @param {{
 *   S: import("./state.js").Store,
 *   sockets: import("./http.js").Sockets,
 *   resolve: (key: string | undefined) => Target | undefined,
 *   toast: (text: string, level?: "info" | "error" | "success") => void,
 *   persist: (thread: Thread, now?: boolean) => void,
 * }} deps
 */
export function createRunner({ S, sockets, resolve, toast, persist }) {
  /** @type {AbortController | null} */
  let running = null;

  /** The model a thread answers with, when its server answers. @param {Thread} thread */
  function targetOf(thread) {
    const target = resolve(thread.model ?? S.get().selected);
    if (target?.server?.status === "online")
      return /** @type {Target & { server: Server }} */ (target);
    toast(
      target?.server ? `${target.server.label} is not answering.` : "Pick a model first.",
      "error",
    );
    return undefined;
  }

  /**
   * Write an answer under `parentId`, streaming it into a new assistant node, or, with `into`, onto the
   * end of an answer that stopped (the answer so far goes as the last message, for the model to go on).
   * @param {Thread} thread @param {string} parentId @param {{ into?: Node, extra?: Partial<import("./chat-types.js").ChatRequest> }} [o]
   */
  async function generate(thread, parentId, o = {}) {
    const target = targetOf(thread);
    if (!target) return undefined;
    const { server, id, model } = target;
    const node =
      o.into ??
      addNode(thread, parentId, {
        role: "assistant",
        content: "",
        model: id,
        modelName: model?.name ?? id,
        ...(thread.format ? { format: thread.format === "json" ? "json" : "schema" } : {}),
      });
    const before = { tokens: node.stats?.tokens ?? 0, content: node.content };
    const messages = messagesFor(thread, o.into ? o.into.id : parentId);
    if (o.into) delete node.error;
    const controller = new AbortController();
    running = controller;
    S.set({ generating: { threadId: thread.id, nodeId: node.id } });
    S.touch("thread");
    const started = Date.now();
    /** @type {number | undefined} */
    let thinkingFrom;
    let frame = 0;
    let pieces = 0;
    /** @type {number | undefined} */
    let firstAt;
    const redraw = () => {
      if (frame) return;
      frame = 1;
      const next = globalThis.requestAnimationFrame ?? ((fn) => setTimeout(fn, 16));
      next(() => {
        frame = 0;
        const secs = firstAt ? (Date.now() - firstAt) / 1000 : 0;
        S.signal("stream", { node, speed: secs > 0.25 ? pieces / secs : undefined });
      });
    };
    try {
      const result = await clientOf(server.kind).chat(
        sockets,
        server,
        {
          model: id,
          messages,
          params: thread.params,
          think: thinkOf(target, thread),
          format: thread.format,
          signal: controller.signal,
          ...o.extra,
        },
        (delta) => {
          firstAt ??= Date.now();
          if (delta.reasoning) {
            thinkingFrom ??= Date.now();
            node.reasoning = (node.reasoning ?? "") + delta.reasoning;
          }
          if (delta.content) {
            pieces++;
            if (thinkingFrom !== undefined && node.reasoningMs === undefined && node.reasoning)
              node.reasoningMs = Date.now() - thinkingFrom;
            node.content += delta.content;
            if (!node.reasoning && node.reasoningMs === undefined) {
              const inline = splitThink(node.content);
              if (inline.open) thinkingFrom ??= Date.now();
              else if (inline.reasoning && thinkingFrom !== undefined)
                node.reasoningMs = Date.now() - thinkingFrom;
            }
          }
          redraw();
        },
      );
      node.stats = o.into
        ? { ...result.stats, tokens: (result.stats.tokens ?? 0) + before.tokens }
        : result.stats;
      if (result.toolCalls.length) node.toolCalls = result.toolCalls;
    } catch (e) {
      const code = /** @type {{ code?: string }} */ (e)?.code;
      if (controller.signal.aborted || code === "aborted")
        node.stats = {
          ...node.stats,
          tokens: before.tokens + pieces,
          stopReason: "stopped",
          totalMs: Date.now() - started,
        };
      else node.error = message(e);
    } finally {
      if (!node.reasoning) {
        const split = splitThink(node.content);
        if (split.reasoning) {
          node.reasoning = split.reasoning;
          node.content = split.content;
        }
      }
      if (running === controller) running = null;
      S.set({ generating: null });
      S.touch("thread");
      persist(thread, true);
    }
    return node;
  }

  /**
   * Ask a model once, without the window: the whole answer, its reasoning taken out.
   * @param {string} key @param {ChatMessage[]} messages @param {{ params?: Sampling, signal?: AbortSignal, format?: any }} [o]
   */
  async function complete(key, messages, o = {}) {
    const target = resolve(key);
    if (target?.server?.status !== "online")
      throw new Error("That model's server is not answering");
    const result = await clientOf(target.server.kind).chat(
      sockets,
      target.server,
      {
        model: target.id,
        messages,
        params: o.params,
        think:
          target.server.kind === "ollama" && target.model?.caps.includes("reasoning")
            ? false
            : undefined,
        signal: o.signal,
        format: o.format,
      },
      () => {},
    );
    return { ...result, content: splitThink(result.content).content.trim() };
  }

  return {
    generate,
    complete,
    stop: () => running?.abort(),
    get running() {
      return Boolean(running);
    },
  };
}
