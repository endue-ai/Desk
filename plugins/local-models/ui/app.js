// What the window does, apart from drawing it: find the servers and their models, keep the threads,
// and run an answer — the request built from the path of the thread, the tokens streamed into the
// node being written, the stats kept with it, stopped when asked.

import { modelKey, splitKey } from "./models.js";
import { createSockets } from "./net.js";
import { clientOf, discover } from "./servers.js";
import { createState } from "./state.js";
import { createStore } from "./store.js";
import { splitThink } from "./think.js";
import { addNode, createThread, entryOf, leaf, pathTo, removeNode, titleFrom } from "./threads.js";

/**
 * @typedef {import("./net.js").Bridge} Bridge
 * @typedef {import("./threads.js").Thread} Thread
 * @typedef {import("./threads.js").Node} Node
 * @typedef {import("./models.js").Model} Model
 * @typedef {import("./chat-types.js").ChatMessage} ChatMessage
 * @typedef {import("./chat-types.js").Image} Image
 */

const message = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));

/** @param {Bridge} bridge @param {{ storeDelayMs?: number }} [options] */
export function createApp(bridge, options = {}) {
  const S = createState();
  const sockets = createSockets(bridge);
  const store = createStore(bridge, { delayMs: options.storeDelayMs });
  /** @type {AbortController | null} */
  let running = null;
  /** @type {import("./servers.js").ServerSpec[]} */
  let added = [];

  const toast = (
    /** @type {string} */ text,
    level = /** @type {"info" | "error" | "success"} */ ("info"),
  ) => S.set({ toast: { text, level, at: Date.now() } });

  /** The model a key names, with its server. @param {string | undefined} key */
  function resolve(key) {
    const { servers, models } = S.get();
    if (!key) return undefined;
    const model = models.find((m) => modelKey(m) === key);
    const { serverId, id } = splitKey(key);
    const server = servers.find((s) => s.id === serverId);
    return { model, server, id };
  }

  /** Look at every server again and gather their models. */
  async function scan() {
    S.set({ scanning: true });
    try {
      const servers = await discover(sockets, added);
      const lists = await Promise.all(
        servers
          .filter((s) => s.status === "online")
          .map((s) =>
            clientOf(s.kind)
              .listModels(sockets, s)
              .catch((e) => {
                s.error = message(e);
                return /** @type {Model[]} */ ([]);
              }),
          ),
      );
      const models = lists.flat();
      const { selected } = S.get();
      const chat = models.filter((m) => !m.caps.includes("embedding"));
      const keep = selected && models.some((m) => modelKey(m) === selected);
      const pick = keep ? selected : (chat.find((m) => m.loaded) ?? chat[0]);
      S.set({
        servers,
        models,
        scanning: false,
        selected: typeof pick === "string" ? pick : pick ? modelKey(pick) : "",
      });
    } catch (e) {
      S.set({ scanning: false });
      toast(`Could not look for servers: ${message(e)}`, "error");
    }
  }

  function saveIndex() {
    const { threads } = S.get();
    store.saveIndex(threads);
  }

  /** Put a thread's entry first in the list, or update it there. @param {Thread} thread */
  function indexThread(thread) {
    const entry = entryOf(thread);
    const rest = S.get().threads.filter((t) => t.id !== thread.id);
    S.set({ threads: [entry, ...rest] });
    saveIndex();
  }

  /** @param {Thread} thread */
  function persist(thread, now = false) {
    if (!Object.keys(thread.nodes).length) return;
    indexThread(thread);
    void store
      .saveThread(thread, { now })
      .catch((e) => toast(`Could not save: ${message(e)}`, "error"));
  }

  /** A new, empty thread on the model chosen (not saved until it has a message). @param {string} [model] */
  function newChat(model) {
    const key = model ?? S.get().selected;
    const thread = createThread({ model: key || undefined });
    S.set({ thread, view: "chat" });
    return thread;
  }

  /** @param {string} id */
  async function openThread(id) {
    if (S.get().thread?.id === id) return S.get().thread;
    const thread = await store.thread(id).catch(() => undefined);
    if (!thread) {
      toast("That thread's file is gone.", "error");
      S.set({ threads: S.get().threads.filter((t) => t.id !== id) });
      saveIndex();
      return null;
    }
    S.set({ thread, view: "chat" });
    if (thread.model) S.set({ selected: thread.model });
    return thread;
  }

  /** The messages a request sends: the system prompt, then the path up to a node. @param {Thread} thread @param {string} upTo */
  function messagesFor(thread, upTo) {
    /** @type {ChatMessage[]} */
    const out = [];
    if (thread.system?.trim()) out.push({ role: "system", content: thread.system.trim() });
    for (const node of pathTo(thread, upTo)) {
      if (node.error && !node.content) continue;
      const content = node.role === "assistant" ? splitThink(node.content).content : node.content;
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

  /**
   * Write an answer under `parentId`, streaming it into a new assistant node.
   * @param {Thread} thread @param {string} parentId
   */
  async function generate(thread, parentId) {
    const target = resolve(thread.model ?? S.get().selected);
    if (target?.server?.status !== "online") {
      toast(
        target?.server ? `${target.server.label} is not answering.` : "Pick a model first.",
        "error",
      );
      return undefined;
    }
    const { server, id, model } = target;
    const node = addNode(thread, parentId, {
      role: "assistant",
      content: "",
      model: id,
      modelName: model?.name ?? id,
    });
    const controller = new AbortController();
    running = controller;
    S.set({ generating: { threadId: thread.id, nodeId: node.id } });
    S.touch("thread");
    const started = Date.now();
    /** @type {number | undefined} */
    let thinkingFrom;
    let frame = 0;
    const redraw = () => {
      if (frame) return;
      frame = 1;
      queueMicrotask(() => {
        frame = 0;
        S.signal("stream", node);
      });
    };
    try {
      const result = await clientOf(server.kind).chat(
        sockets,
        server,
        {
          model: id,
          messages: messagesFor(thread, parentId),
          params: thread.params,
          think:
            server.kind === "ollama" && model?.caps.includes("reasoning")
              ? thread.think !== false
              : undefined,
          signal: controller.signal,
        },
        (delta) => {
          if (delta.reasoning) {
            thinkingFrom ??= Date.now();
            node.reasoning = (node.reasoning ?? "") + delta.reasoning;
          }
          if (delta.content) {
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
      node.stats = result.stats;
      if (result.toolCalls.length) node.toolCalls = result.toolCalls;
    } catch (e) {
      const code = /** @type {{ code?: string }} */ (e)?.code;
      if (controller.signal.aborted || code === "aborted")
        node.stats = { ...node.stats, stopReason: "stopped", totalMs: Date.now() - started };
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
   * Send what the person wrote, then answer it.
   * @param {string} text @param {{ images?: Image[] }} [extra]
   */
  async function send(text, extra = {}) {
    if (S.get().generating) return;
    const body = text.trim();
    if (!body && !extra.images?.length) return;
    const thread = S.get().thread ?? newChat();
    if (!thread.model) thread.model = S.get().selected || undefined;
    const fresh = !Object.keys(thread.nodes).length;
    if (fresh) thread.title = titleFrom(body || "Image");
    const parent = leaf(thread);
    const user = addNode(thread, parent?.id ?? null, {
      role: "user",
      content: body,
      ...(extra.images?.length ? { images: extra.images } : {}),
    });
    S.set({ thread });
    persist(thread);
    await generate(thread, user.id);
  }

  /** Stop the answer being written; what came so far stays. */
  function stop() {
    running?.abort();
  }

  /** Ask again for the answer to the question above `nodeId`: a sibling of it. @param {string} nodeId */
  async function regenerate(nodeId) {
    const thread = S.get().thread;
    const node = thread?.nodes[nodeId];
    if (!thread || !node || S.get().generating) return;
    const parent = node.role === "assistant" ? node.parent : node.id;
    if (!parent) return;
    await generate(thread, parent);
  }

  /** @param {string} id */
  async function deleteThread(id) {
    await store.removeThread(id).catch((e) => toast(`Could not remove: ${message(e)}`, "error"));
    const threads = S.get().threads.filter((t) => t.id !== id);
    S.set({ threads, ...(S.get().thread?.id === id ? { thread: null } : {}) });
    saveIndex();
  }

  /** @param {string} id @param {Partial<Pick<Thread, "title" | "pinned">>} patch */
  async function updateThread(id, patch) {
    const open = S.get().thread;
    const thread = open?.id === id ? open : await store.thread(id).catch(() => undefined);
    if (!thread) return;
    Object.assign(thread, patch, patch.title ? { titled: true } : {});
    if (open?.id === id) S.touch("thread");
    persist(thread, true);
  }

  /** Remove one message and what follows it. @param {string} nodeId */
  function deleteNode(nodeId) {
    const thread = S.get().thread;
    if (!thread || S.get().generating) return;
    removeNode(thread, nodeId);
    S.touch("thread");
    persist(thread);
  }

  /** Choose the model for new answers, in the open thread too. @param {string} key */
  function choose(key) {
    const thread = S.get().thread;
    if (thread) {
      thread.model = key;
      if (Object.keys(thread.nodes).length) persist(thread);
    }
    S.set({ selected: key, picker: false });
    S.touch("thread");
    void store.set("selected", key);
  }

  async function start() {
    const [threads, selected, prefs, servers] = await Promise.all([
      store.index().catch(() => []),
      store.get("selected"),
      store.get("prefs"),
      store.get("servers"),
    ]);
    added = Array.isArray(servers) ? servers : [];
    S.set({
      threads,
      selected: typeof selected === "string" ? selected : "",
      ...(prefs && typeof prefs === "object" ? prefs : {}),
    });
    await scan();
    S.set({ ready: true });
  }

  /** Read the added servers again, then look at every server. */
  async function reloadServers() {
    const servers = await store.get("servers");
    added = Array.isArray(servers) ? servers : [];
    await scan();
  }

  /** Remember the window's layout. */
  function savePrefs() {
    const { inspector, sidebar } = S.get();
    void store.set("prefs", { inspector, sidebar });
  }

  return {
    S,
    sockets,
    store,
    start,
    scan,
    reloadServers,
    resolve,
    newChat,
    openThread,
    send,
    stop,
    regenerate,
    deleteThread,
    updateThread,
    deleteNode,
    choose,
    toast,
    savePrefs,
    persist,
    generate,
    messagesFor,
  };
}

/** @typedef {ReturnType<typeof createApp>} App */
