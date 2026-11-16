// What the window does, apart from drawing it: find the servers and their models, keep the threads,
// and run an answer — the request built from the path of the thread, the tokens streamed into the
// node being written, the stats kept with it, stopped when asked.

import { nameThread } from "./edit.js";
import { createLocal } from "./local.js";
import { modelKey, splitKey } from "./models.js";
import { createSockets } from "./net.js";
import { createPresets, settingsOf } from "./presets.js";
import { createRunner } from "./run.js";
import { clientOf, discover } from "./servers.js";
import { createState } from "./state.js";
import { createStore } from "./store.js";
import { addNode, createThread, entryOf, leaf, removeNode, titleFrom } from "./threads.js";

/**
 * @typedef {import("./net.js").Bridge} Bridge
 * @typedef {import("./threads.js").Thread} Thread
 * @typedef {import("./threads.js").Node} Node
 * @typedef {import("./models.js").Model} Model
 * @typedef {import("./chat-types.js").ChatMessage} ChatMessage
 * @typedef {import("./chat-types.js").Image} Image
 */

const message = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));

/** @param {Bridge} bridge @param {{ storeDelayMs?: number, autoTitle?: boolean }} [options] */
export function createApp(bridge, options = {}) {
  const S = createState();
  const sockets = createSockets(bridge);
  const store = createStore(bridge, { delayMs: options.storeDelayMs });
  /** @type {import("./servers.js").ServerSpec[]} */
  let added = [];
  let autoTitle = options.autoTitle ?? true;
  /** @type {() => (import("./servers.js").ServerSpec & { managed?: boolean })[]} */
  let extraServers = () => [];
  const presets = createPresets(store);
  /** @type {import("./presets.js").Settings & { format?: any }} */
  let defaults = {};

  const toast = (
    /** @type {string} */ text,
    level = /** @type {"info" | "error" | "success"} */ ("info"),
  ) => S.set({ toast: { text, level, at: Date.now() } });

  /** The model a key names, with its server. @param {string | undefined} key */
  function resolve(key) {
    const { servers, models } = S.get();
    if (!key) return undefined;
    const { serverId, id } = splitKey(key);
    let model = models.find((m) => modelKey(m) === key);
    // A model loaded again by the built-in engine answers on another port: the same name still finds it.
    if (!model && !servers.some((s) => s.id === serverId && s.status === "online"))
      model = models.find((m) => m.id === id && servers.find((s) => s.id === m.serverId)?.managed);
    const server = servers.find((s) => s.id === (model?.serverId ?? serverId));
    return { model, server, id };
  }

  /** Look at every server again and gather their models. */
  async function scan() {
    S.set({ scanning: true });
    try {
      const extra = extraServers();
      const servers = (await discover(sockets, [...added, ...extra])).map((s) => {
        const managed = extra.find((e) => e.port === s.port && e.host === s.host);
        return managed ? { ...s, managed: true, label: managed.label ?? s.label, added: false } : s;
      });
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

  /** Ask one server for its models again (which are in memory changes as they answer). @param {string} serverId */
  async function refreshModels(serverId) {
    const server = S.get().servers.find((s) => s.id === serverId);
    if (server?.status !== "online") return;
    const fresh = await clientOf(server.kind)
      .listModels(sockets, server)
      .catch(() => undefined);
    if (!fresh) return;
    const known = new Map(S.get().models.map((m) => [modelKey(m), m]));
    const merged = fresh.map((m) => {
      const old = known.get(modelKey(m));
      return old ? { ...m, ctx: m.ctx ?? old.ctx, caps: old.ctx ? old.caps : m.caps } : m;
    });
    S.set({ models: [...S.get().models.filter((m) => m.serverId !== serverId), ...merged] });
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

  const runner = createRunner({ S, sockets, resolve, toast, persist });

  /** A new, empty thread on the model chosen (not saved until it has a message). @param {string} [model] */
  function newChat(model) {
    const key = model ?? S.get().selected;
    const thread = createThread({ model: key || undefined });
    const preset = presets.get(defaults.preset);
    Object.assign(thread, preset ? settingsOf(preset) : {}, structuredClone(defaults));
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
    const answer = await runner.generate(thread, user.id);
    const sid = thread.model ? splitKey(thread.model).serverId : "";
    if (answer && sid) void refreshModels(sid);
    if (fresh && answer?.content && autoTitle) void nameThread(api, thread);
  }

  /** Stop the answer being written; what came so far stays. */
  function stop() {
    runner.stop();
  }

  /** Ask again for the answer to the question above `nodeId`: a sibling of it. @param {string} nodeId */
  async function regenerate(nodeId) {
    const thread = S.get().thread;
    const node = thread?.nodes[nodeId];
    if (!thread || !node || S.get().generating) return;
    const parent = node.role === "assistant" ? node.parent : node.id;
    if (!parent) return;
    await runner.generate(thread, parent);
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
    void describe(key);
    S.touch("thread");
    void store.set("selected", key);
  }

  async function start() {
    const [threads, selected, prefs, servers, saved] = await Promise.all([
      store.index().catch(() => []),
      store.get("selected"),
      store.get("prefs"),
      store.get("servers"),
      store.get("defaults"),
      presets.load(),
    ]);
    defaults = saved && typeof saved === "object" ? saved : {};
    added = Array.isArray(servers) ? servers : [];
    S.set({
      threads,
      selected: typeof selected === "string" ? selected : "",
      ...(prefs && typeof prefs === "object" ? prefs : {}),
    });
    await scan();
    await local.start().catch(() => {});
    S.set({ ready: true });
    void describe(S.get().selected);
  }

  /** Read the added servers again, then look at every server. */
  async function reloadServers() {
    const servers = await store.get("servers");
    added = Array.isArray(servers) ? servers : [];
    await scan();
  }

  /** Keep a chat's settings as what new chats start with. @param {Thread} thread */
  async function saveDefaults(thread) {
    defaults = structuredClone({
      system: thread.system || undefined,
      params: thread.params,
      preset: thread.preset,
      think: thread.think,
      format: thread.format,
    });
    await store.set("defaults", defaults);
    toast("New chats start with these settings.", "success");
  }

  /** What the server says about a model it lists by name only: its context length and abilities. @param {string} key */
  async function describe(key) {
    const target = resolve(key);
    if (target?.server?.kind !== "ollama" || !target.model || target.model.ctx) return;
    const info = await clientOf("ollama")
      .showModel(sockets, target.server, target.id)
      .catch(() => undefined);
    if (!info) return;
    const models = S.get().models.map((m) =>
      m === target.model
        ? { ...m, ctx: info.ctx ?? m.ctx, caps: info.caps.length ? info.caps : m.caps }
        : m,
    );
    S.set({ models });
  }

  /** Open a link from an answer in the browser. @param {string} url */
  async function openLink(url) {
    await bridge
      .call("shell.open", { target: url })
      .catch(() => toast("The desk did not open the link.", "error"));
  }

  /** Remember the window's layout. */
  function savePrefs() {
    const { inspector, sidebar } = S.get();
    void store.set("prefs", { inspector, sidebar });
  }

  const api = {
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
    saveDefaults,
    describe,
    refreshModels,
    presets,
    openLink,
    persist,
    runner,
    indexThread,
    saveIndex,
    /** Servers the window started itself, looked at with the others. @param {typeof extraServers} fn */
    setExtraServers(fn) {
      extraServers = fn;
    },
    /** @param {boolean} on */
    setAutoTitle(on) {
      autoTitle = on;
    },
  };
  const local = createLocal(api);
  return Object.assign(api, { local });
}

/** @typedef {ReturnType<typeof createApp>} App */
