// The window's state in one object, changed only through set(), which tells the views that read
// the keys it changed. Streaming tokens go out as `stream` signals instead, so only the message
// being written redraws.

/**
 * @typedef {import("./servers.js").Server} Server
 * @typedef {import("./models.js").Model} Model
 * @typedef {import("./threads.js").Thread} Thread
 * @typedef {import("./threads.js").ThreadEntry} ThreadEntry
 * @typedef {{
 *   view: "chat" | "models" | "discover" | "server" | "compare" | "settings",
 *   servers: Server[],
 *   models: Model[],
 *   scanning: boolean,
 *   threads: ThreadEntry[],
 *   thread: Thread | null,
 *   selected: string,
 *   generating: { threadId: string, nodeId: string } | null,
 *   search: string,
 *   picker: boolean,
 *   inspector: boolean,
 *   sidebar: boolean,
 *   toast: { text: string, level: "info" | "error" | "success", at: number } | null,
 *   ready: boolean,
 *   local: import("./library.js").LocalModel[],
 *   engines: import("./local.js").EngineView[],
 *   memory: import("./memory.js").Memory | undefined,
 *   folders: string[],
 *   libraryScanning: boolean,
 *   enginePath: string,
 *   downloads: import("./downloads.js").Download[],
 * }} State
 */

/** @returns {State} */
export function initialState() {
  return {
    view: "chat",
    servers: [],
    models: [],
    scanning: false,
    threads: [],
    thread: null,
    selected: "",
    generating: null,
    search: "",
    picker: false,
    inspector: false,
    sidebar: true,
    toast: null,
    ready: false,
    local: [],
    engines: [],
    memory: undefined,
    folders: [],
    libraryScanning: false,
    enginePath: "",
    downloads: [],
  };
}

/** @param {State} [initial] */
export function createState(initial = initialState()) {
  let state = initial;
  /** @type {Set<{ keys: Set<string> | null, fn: (s: State, changed: Set<string>) => void }>} */
  const listeners = new Set();
  /** @type {Map<string, Set<(payload: any) => void>>} */
  const signals = new Map();
  return {
    get: () => state,
    /** @param {Partial<State>} patch */
    set(patch) {
      state = { ...state, ...patch };
      const changed = new Set(Object.keys(patch));
      for (const l of [...listeners])
        if (!l.keys || [...changed].some((k) => l.keys?.has(k))) l.fn(state, changed);
    },
    /** Tell the views that read `key` it changed in place (a thread edited). @param {(keyof State)[]} keys */
    touch(...keys) {
      const changed = new Set(/** @type {string[]} */ (keys));
      for (const l of [...listeners])
        if (!l.keys || [...changed].some((k) => l.keys?.has(k))) l.fn(state, changed);
    },
    /**
     * @param {(keyof State)[] | null} keys @param {(s: State, changed: Set<string>) => void} fn
     */
    on(keys, fn) {
      const entry = { keys: keys ? new Set(/** @type {string[]} */ (keys)) : null, fn };
      listeners.add(entry);
      return () => listeners.delete(entry);
    },
    /** @param {string} name @param {any} [payload] */
    signal(name, payload) {
      for (const fn of signals.get(name) ?? []) fn(payload);
    },
    /** @param {string} name @param {(payload: any) => void} fn */
    onSignal(name, fn) {
      const set = signals.get(name) ?? new Set();
      set.add(fn);
      signals.set(name, set);
      return () => set.delete(fn);
    },
  };
}

/** @typedef {ReturnType<typeof createState>} Store */
