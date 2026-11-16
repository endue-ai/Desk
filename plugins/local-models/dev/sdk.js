// The preview's stand-in for /_desk/plugin-sdk.js: defineUiPlugin and the parts of the context the
// window uses. net.* opens real sockets through dev/serve.mjs (to this computer only), fs.* reaches a
// folder of the preview's own, store.* and the state live in localStorage, and everything the desk
// would ask the person is granted. `?scheme=light` picks the light theme, `?fresh` starts with no
// saved state.

const query = new URLSearchParams(location.search);
document.documentElement.dataset.scheme = query.get("scheme") ?? "dark";
if (query.get("scheme") === "light") {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/_dev/theme.css?id=desk.theme.light";
  document.head.append(link);
}
const PREFIX = "local-models-preview:";
if (query.has("fresh"))
  for (const key of Object.keys(localStorage))
    if (key.startsWith(PREFIX)) localStorage.removeItem(key);

/** @type {Set<(event: unknown) => void>} */
const listeners = new Set();
const emit = (/** @type {unknown} */ event) => {
  for (const listener of listeners) listener(event);
};
let next = 0;
const fail = (/** @type {string} */ code, /** @type {string} */ message) =>
  Object.assign(new Error(message), { code });

/** POST to the preview server and unwrap { result } or { error }. @param {string} path @param {unknown} params */
async function devCall(path, params) {
  const answer = await (await fetch(path, { method: "POST", body: JSON.stringify(params) })).json();
  if (answer.error) throw fail(answer.error.code, answer.error.message);
  return answer.result;
}

/** Read a socket's bytes as the server streams them, and pass them on as net.* events. @param {string} socketId */
async function pump(socketId) {
  const response = await fetch(`/_dev/net/read?id=${encodeURIComponent(socketId)}`);
  const reader = /** @type {ReadableStream<Uint8Array>} */ (response.body).getReader();
  const decoder = new TextDecoder();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
    let at = rest.indexOf("\n");
    while (at >= 0) {
      const line = JSON.parse(rest.slice(0, at));
      rest = rest.slice(at + 1);
      if (line.data) emit({ event: "net.data", data: { socketId, data: line.data } });
      if (line.closed) {
        emit({ event: "net.closed", data: { socketId } });
        return;
      }
      at = rest.indexOf("\n");
    }
  }
  emit({ event: "net.closed", data: { socketId, reason: "io_error" } });
}

/** @param {string} method @param {any} params */
async function call(method, params) {
  if (method === "net.connect") {
    const result = await devCall("/_dev/net/connect", params);
    void pump(result.socketId);
    return result;
  }
  if (method === "net.send") return devCall("/_dev/net/send", params);
  if (method === "net.close") return devCall("/_dev/net/close", params);
  if (method === "perm.request") return { granted: true };
  if (method === "store.get")
    return {
      value:
        JSON.parse(localStorage.getItem(`${PREFIX}store:${params.key}`) ?? "null") ?? undefined,
    };
  if (method === "store.set") {
    localStorage.setItem(`${PREFIX}store:${params.key}`, JSON.stringify(params.value));
    return {};
  }
  if (method.startsWith("fs.") && method !== "fs.watch")
    return devCall("/_dev/fs", { method, params });
  if (method === "fs.watch") return { watchId: `w${++next}` };
  if (method === "dialog.open") {
    const paths = /** @type {any} */ (window).__pick?.(params);
    return paths
      ? { cancelled: false, paths: Array.isArray(paths) ? paths : [paths] }
      : { cancelled: true, paths: [] };
  }
  if (method === "shell.open" || method === "ui.notify" || method === "log.write") return {};
  throw fail("unsupported", `${method} is not in the preview`);
}

/** @type {Map<string, (args: unknown) => unknown>} */
const handlers = new Map();

/** @param {{ mount(ctx: any): void }} plugin */
export async function defineUiPlugin(plugin) {
  const config = await (await fetch("/_dev/config")).json();
  /** @type {any} */ (window).__config = config;
  const stateKey = `${PREFIX}state`;
  let state = JSON.parse(localStorage.getItem(stateKey) ?? "null") ?? undefined;
  /** @type {Set<(change: any) => void>} */
  const settingListeners = new Set();
  plugin.mount({
    pluginId: "endue.local-models",
    instance: "endue.local-models",
    bridge: {
      call,
      onEvent: (/** @type {any} */ l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },
    state: {
      get: () => state,
      set: (/** @type {unknown} */ value) => {
        state = value;
        localStorage.setItem(stateKey, JSON.stringify(value));
      },
    },
    settings: {
      get: async (/** @type {string} */ key) =>
        JSON.parse(localStorage.getItem(`${PREFIX}setting:${key}`) ?? "null") ?? undefined,
      set: async (/** @type {string} */ key, /** @type {unknown} */ value) => {
        localStorage.setItem(`${PREFIX}setting:${key}`, JSON.stringify(value));
        for (const l of settingListeners) l({ key, value, owner: "endue.local-models" });
      },
      onChange: (/** @type {(change: any) => void} */ l) => {
        settingListeners.add(l);
        return () => settingListeners.delete(l);
      },
    },
    commands: {
      on: (/** @type {string} */ name, /** @type {any} */ handler) => handlers.set(name, handler),
      run: async (/** @type {string} */ id) => {
        throw fail("unknown_command", `${id} is not in the preview`);
      },
      list: async () => [],
    },
    theme: { get: () => undefined, on: () => () => {} },
    surface: { show() {}, hide() {}, onUnload: () => () => {}, restored: undefined },
  });
  /** @type {any} */ (window).__commands = handlers;
}
